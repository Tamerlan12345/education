import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import gaxios from 'gaxios';
import pdf from 'pdf-parse';

// --- Инициализация клиентов ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
const SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY; // Используется для доступа к Drive

// --- Вспомогательные функции ---
async function getFileContentAsText(fileId) {
    const exportUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain&key=${SHEETS_API_KEY}`;
    try {
        return (await gaxios.request({ url: exportUrl, responseType: 'text' })).data;
    } catch (exportError) {
        const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${SHEETS_API_KEY}`;
        try {
            const response = await gaxios.request({ url: downloadUrl, responseType: 'arraybuffer' });
            return (await pdf(response.data)).text;
        } catch (downloadError) {
            throw new Error('Не удалось прочитать файл. Убедитесь, что доступ к файлу открыт по ссылке.');
        }
    }
}

async function generateCourseFromAI(fileContent) {
    const prompt = `
        Задание: Ты — опытный AI-наставник. Создай подробный и понятный пошаговый план обучения из 3-5 уроков (слайдов) на основе текста документа. Каждый раз генерируй немного разный текст и примеры, но СТРОГО в рамках документа.
        Требования к результату:
        1.  Для каждого урока-слайда создай: "title" (заголовок) и "html_content" (подробный обучающий текст в HTML-разметке).
        2.  После всех уроков создай 5 тестовых вопросов по всему материалу.
        3.  Верни результат СТРОГО в формате JSON.
        Структура JSON:
        {
          "summary": [
            { "title": "Урок 1: Введение", "html_content": "<p>Текст...</p>" },
            { "title": "Урок 2: Основные риски", "html_content": "<p>Текст...</p>" }
          ],
          "questions": [
            { "question": "Вопрос 1", "options": ["A", "B", "C"], "correct_option_index": 0 }
          ]
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
        // 1. Найти курс в базе данных
        const { data: courseData, error: courseError } = await supabase
            .from('courses')
            .select('doc_id, content_html, questions')
            .eq('course_id', course_id)
            .single();

        if (courseError || !courseData) throw new Error('Курс не найден в базе данных.');
        
        // 2. Проверить кэш. Если есть контент и не нужна регенерация, отдать его.
        if (courseData.content_html && courseData.questions && force_regenerate !== 'true') {
            return {
                statusCode: 200,
                body: JSON.stringify({ summary: courseData.content_html, questions: courseData.questions }),
            };
        }

        // 3. Если кэша нет или нужна регенерация -> генерируем новый контент
        const fileContent = await getFileContentAsText(courseData.doc_id);
        const newContent = await generateCourseFromAI(fileContent);

        // 4. Сохраняем новый контент в базу данных
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
