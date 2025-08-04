import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import gaxios from 'gaxios';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
const GOOGLE_API_KEY = process.env.GOOGLE_SHEETS_API_KEY; 

async function getFileContentFromGoogleDrive(fileId) {
    const metaUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType&key=${GOOGLE_API_KEY}`;
    const metaResponse = await gaxios.request({ url: metaUrl });
    const mimeType = metaResponse.data.mimeType;

    let textContent = '';

    switch (mimeType) {
        case 'application/vnd.google-apps.document':
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
            const exportUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain&key=${GOOGLE_API_KEY}`;
            textContent = (await gaxios.request({ url: exportUrl, responseType: 'text' })).data;
            break;
        case 'application/pdf':
            const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${GOOGLE_API_KEY}`;
            const response = await gaxios.request({ url: downloadUrl, responseType: 'arraybuffer' });
            textContent = (await pdf(response.data)).text;
            break;
        default:
            throw new Error(`Unsupported file type: ${mimeType}. Поддерживаются только Google Docs, PDF и .docx.`);
    }
    return textContent;
}

async function generateCourseFromAI(fileContent) {
    const prompt = `Задание: Ты — опытный AI-наставник. Создай подробный и понятный пошаговый план обучения из 3-5 уроков (слайдов) на основе текста документа. Каждый раз генерируй немного разный текст и примеры, но СТРОГО в рамках документа. Требования к результату: 1.  Для каждого урока-слайда создай: "title" (заголовок) и "html_content" (подробный обучающий текст в HTML-разметке). 2.  После всех уроков создай 5 тестовых вопросов по всему материалу. 3.  Верни результат СТРОГО в формате JSON. Структура JSON: { "summary": [ { "title": "Урок 1: Введение", "html_content": "<p>Текст...</p>" } ], "questions": [ { "question": "Вопрос 1", "options": ["A", "B", "C"], "correct_option_index": 0 } ] } ТЕКСТ ДОКУМЕНТА ДЛЯ ОБРАБОТКИ: --- ${fileContent} ---`;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const jsonString = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(jsonString);
}

export const handler = async (event) => {
    try {
        const token = event.headers.authorization.split(' ')[1];
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) throw new Error('Unauthorized');

        const { course_id, force_regenerate } = event.queryStringParameters;
        if (!course_id) return { statusCode: 400, body: JSON.stringify({ error: 'course_id is required' }) };

        const { data: courseData, error: courseError } = await supabase.from('courses').select('doc_id, content_html, questions').eq('course_id', course_id).single();
        if (courseError || !courseData) throw new Error('Курс не найден.');
        
        if (courseData.content_html && courseData.questions && force_regenerate !== 'true') {
            return { statusCode: 200, body: JSON.stringify({ summary: courseData.content_html, questions: courseData.questions }) };
        }

        const fileContent = await getFileContentFromGoogleDrive(courseData.doc_id);
        const newContent = await generateCourseFromAI(fileContent);

        const { error: updateError } = await supabase.from('courses').update({ content_html: newContent.summary, questions: newContent.questions, last_updated: new Date().toISOString() }).eq('course_id', course_id);
        if (updateError) throw updateError;

        return { statusCode: 200, body: JSON.stringify(newContent) };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
