import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import mammoth from 'mammoth';
import pdf from 'pdf-parse';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

async function getFileContentAsText(filePath) {
    const { data: fileData, error: downloadError } = await supabase.storage.from('course_materials').download(filePath);
    if (downloadError) throw new Error(`Не удалось скачать файл: ${downloadError.message}`);
    const fileBuffer = Buffer.from(await fileData.arrayBuffer());
    if (filePath.endsWith('.pdf')) { return (await pdf(fileBuffer)).text; } 
    else if (filePath.endsWith('.docx')) { return (await mammoth.extractRawText({ buffer: fileBuffer })).value; }
    else { throw new Error('Unsupported file type.'); }
}

export const handler = async (event) => {
    try {
        const token = event.headers.authorization.split(' ')[1];
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) throw new Error('Unauthorized');
    
        const { course_id, question } = event.queryStringParameters;
        if (!course_id || !question) return { statusCode: 400, body: JSON.stringify({ error: 'Требуется course_id и question' }) };
    
        const { data: courseData, error: courseError } = await supabase.from('courses').select('file_path').eq('course_id', course_id).single();
        if (courseError || !courseData) throw new Error('Документ для этого курса не найден.');

        const fileContent = await getFileContentAsText(courseData.file_path);
        const prompt = `Задание: Ты — дружелюбный AI-ассистент. Ответь на вопрос сотрудника, используя ТОЛЬКО текст документа ниже. Если ответа в тексте нет, скажи: "К сожалению, в предоставленных материалах я не нашел ответа на этот вопрос." ВОПРОС: "${question}" ТЕКСТ ДОКУМЕНТА: --- ${fileContent} ---`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        
        return { statusCode: 200, body: JSON.stringify({ answer: response.text() }) };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
