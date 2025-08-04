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
            throw new Error(`Unsupported file type: ${mimeType}.`);
    }
    return textContent;
}

export const handler = async (event) => {
    try {
        const token = event.headers.authorization.split(' ')[1];
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) throw new Error('Unauthorized');
    
        const { course_id, question } = event.queryStringParameters;
        if (!course_id || !question) return { statusCode: 400, body: JSON.stringify({ error: 'Требуется course_id и question' }) };
    
        const { data: courseData, error: courseError } = await supabase.from('courses').select('doc_id').eq('course_id', course_id).single();
        if (courseError || !courseData) throw new Error('Документ для этого курса не найден.');

        const fileContent = await getFileContentFromGoogleDrive(courseData.doc_id);
        const prompt = `Задание: Ты — дружелюбный AI-ассистент. Ответь на вопрос сотрудника, используя ТОЛЬКО текст документа ниже. Если ответа в тексте нет, скажи: "К сожалению, в предоставленных материалах я не нашел ответа на этот вопрос." ВОПРОС: "${question}" ТЕКСТ ДОКУМЕНТА: --- ${fileContent} ---`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        
        return { statusCode: 200, body: JSON.stringify({ answer: response.text() }) };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
