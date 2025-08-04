import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import gaxios from 'gaxios';
import pdf from 'pdf-parse';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
const SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY;

async function getFileContentAsText(fileId) {
    // ... (можно скопировать эту функцию из getCourseContent.js)
    const exportUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain&key=${SHEETS_API_KEY}`;
    try {
        return (await gaxios.request({ url: exportUrl, responseType: 'text' })).data;
    } catch (exportError) {
        const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${SHEETS_API_KEY}`;
        try {
            const response = await gaxios.request({ url: downloadUrl, responseType: 'arraybuffer' });
            return (await pdf(response.data)).text;
        } catch (downloadError) {
            throw new Error('Не удалось прочитать файл.');
        }
    }
}

export const handler = async (event) => {
    const { course_id, question } = event.queryStringParameters;
    if (!course_id || !question) return { statusCode: 400, body: JSON.stringify({ error: 'Требуется course_id и question' }) };

    try {
        const { data: courseData, error: courseError } = await supabase
            .from('courses')
            .select('doc_id')
            .eq('course_id', course_id)
            .single();
        if (courseError || !courseData) throw new Error('Документ для этого курса не найден.');

        const fileContent = await getFileContentAsText(courseData.doc_id);
        const prompt = `
            Задание: Ты — дружелюбный AI-ассистент. Ответь на вопрос сотрудника, используя ТОЛЬКО текст документа ниже.
            Если ответа в тексте нет, скажи: "К сожалению, в предоставленных материалах я не нашел ответа на этот вопрос."
            ВОПРОС: "${question}"
            ТЕКСТ ДОКУМЕНТА:
            ---
            ${fileContent}
            ---
        `;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answer: response.text() }),
        };
    } catch (error) {
        console.error("Ошибка ассистента:", error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Не удалось получить ответ. ' + error.message }) };
    }
};
