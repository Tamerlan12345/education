import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

async function getFileContentAsText(filePath) {
    const { data: fileData, error: downloadError } = await supabase.storage.from('course_materials').download(filePath);
    if (downloadError) throw new Error(`Не удалось скачать файл: ${downloadError.message}`);

    const fileBuffer = Buffer.from(await fileData.arrayBuffer());
    
    if (filePath.endsWith('.pdf')) {
        return (await pdf(fileBuffer)).text;
    } else if (filePath.endsWith('.docx')) {
        return (await mammoth.extractRawText({ buffer: fileBuffer })).value;
    } else {
        throw new Error('Поддерживаются только .pdf и .docx.');
    }
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

        const { data: courseData, error: courseError } = await supabase.from('courses').select('file_path, content_html, questions').eq('course_id', course_id).single();
        if (courseError || !courseData) throw new Error('Курс не найден.');
        
        if (courseData.content_html && courseData.questions && force_regenerate !== 'true') {
            return { statusCode: 200, body: JSON.stringify({ summary: courseData.content_html, questions: courseData.questions }) };
        }

        const fileContent = await getFileContentAsText(courseData.file_path);
        const newContent = await generateCourseFromAI(fileContent);

        const { error: updateError } = await supabase.from('courses').update({ content_html: newContent.summary, questions: newContent.questions, last_updated: new Date().toISOString() }).eq('course_id', course_id);
        if (updateError) throw updateError;

        return { statusCode: 200, body: JSON.stringify(newContent) };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
