import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import gaxios from 'gaxios';
import pdf from 'pdf-parse';

// --- Инициализация клиентов ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
const GOOGLE_API_KEY = process.env.GOOGLE_SHEETS_API_KEY; 

// --- Вспомогательные функции ---
async function getFileContentAsText(fileId) {
    // 1. Сначала получаем метаданные файла, чтобы узнать его тип
    const metaUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType&key=${GOOGLE_API_KEY}`;
    const metaResponse = await gaxios.request({ url: metaUrl });
    const mimeType = metaResponse.data.mimeType;

    let textContent = '';

    // 2. Используем правильный метод для извлечения текста в зависимости от типа файла
    switch (mimeType) {
        case 'application/vnd.google-apps.document':
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': // MS Word
            // Для Google Docs и Word используем экспорт в text/plain
            const exportUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain&key=${GOOGLE_API_KEY}`;
            textContent = (await gaxios.request({ url: exportUrl, responseType: 'text' })).data;
            break;
        case 'application/pdf':
            // Для PDF скачиваем файл и парсим его
            const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${GOOGLE_API_KEY}`;
            const response = await gaxios.request({ url: downloadUrl, responseType: 'arraybuffer' });
            const data = await pdf(response.data);
            textContent = data.text;
            break;
        default:
            throw new Error(`Unsupported file type: ${mimeType}. Поддерживаются только Google Docs, PDF и .docx.`);
    }
    return textContent;
}

async function generateCourseFromAI(fileContent) {
    const prompt = `
        Задание: Ты — опытный AI-наставник в страховой компании. Создай подробный и понятный пошаговый план обучения из 3-5 уроков (слайдов) на основе текста документа. Каждый раз генерируй немного разный текст и примеры, но СТРОГО в рамках документа.
        Требования к результату:
        1.  Для каждого урока-слайда создай: "title" (заголовок) и "html_content" (подробный обучающий текст в HTML-разметке).
        2.  После всех уроков создай 5 тестовых вопросов по всему материалу.
        3.  Верни результат СТРОГО в формате JSON.
        Структура JSON:
        {
          "summary": [ { "title": "Урок 1: Введение", "html_content": "<p>Текст...</p>" } ],
          "questions": [ { "question": "Вопрос 1", "options": ["A", "B", "C"], "correct_option_index": 0 } ]
        }
        ТЕКСТ ДОКУМЕНТА ДЛЯ ОБРАБОТКИ:
        ---
        ${fileContent}
        ---
    `;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const jsonString = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(jsonString);
}


// --- Основной обработчик ---
export const handler = async (event) => {
    const { course_id, force_regenerate } = event.queryStringParameters;
    if (!course_id) return { statusCode: 400, body: JSON.stringify({ error: 'course_id is required' }) };

    try {
        const { data: courseData, error: courseError } = await supabase
            .from('courses')
            .select('doc_id, content_html, questions')
            .eq('course_id', course_id)
            .single();

        if (courseError || !courseData) throw new Error('Курс не найден в базе данных.');
        
        if (courseData.content_html && courseData.questions && force_regenerate !== 'true') {
            return {
                statusCode: 200,
                body: JSON.stringify({ summary: courseData.content_html, questions: courseData.questions }),
            };
        }

        const fileContent = await getFileContentAsText(courseData.doc_id);
        const newContent = await generateCourseFromAI(fileContent);

        const { error: updateError } = await supabase
            .from('courses')
            .update({ 
                content_html: newContent.summary,
                questions: newContent.questions,
                last_updated: new Date().toISOString() 
            })
            .eq('course_id', course_id);

        if (updateError) throw updateError;

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newContent),
        };
    } catch (error) {
        console.error("Ошибка при обработке контента курса:", error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Не удалось сгенерировать контент. ' + error.message }) };
    }
};
