const gaxios = require('gaxios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pdf = require('pdf-parse');

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

async function getDocIdByCourseId(courseId) {
    const range = `Лист1!A2:C`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?key=${SHEETS_API_KEY}`;
    try {
        const response = await gaxios.request({ url });
        const rows = response.data.values;
        if (rows) {
            const row = rows.find(r => r[0] === courseId);
            if (row && row[2]) { return row[2]; }
        }
        return null;
    } catch (error) {
        console.error('Ошибка при чтении Google Таблицы:', error);
        throw new Error('Не удалось получить doc_id из таблицы.');
    }
}

async function getFileContentAsText(fileId) {
    const exportUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain&key=${SHEETS_API_KEY}`;
    try {
        return (await gaxios.request({ url: exportUrl, responseType: 'text' })).data;
    } catch (exportError) {
        console.log('Не удалось экспортировать, пробую скачать как PDF...');
        const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${SHEETS_API_KEY}`;
        try {
            const response = await gaxios.request({ url: downloadUrl, responseType: 'arraybuffer' });
            return (await pdf(response.data)).text;
        } catch (downloadError) {
            throw new Error('Не удалось прочитать файл. Файл не является ни Google Документом, ни PDF, или доступ к нему закрыт.');
        }
    }
}

exports.handler = async function (event, context) {
    const { course_id, question } = event.queryStringParameters;

    if (!course_id || !question) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Требуется course_id и question' }) };
    }

    try {
        const doc_id = await getDocIdByCourseId(course_id);
        if (!doc_id) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Не найден документ для этого курса.' }) };
        }
        
        const fileContent = await getFileContentAsText(doc_id);

        // --- ОБНОВЛЕННЫЙ ПРОМПТ ---
        const prompt = `
            Задание: Ты — дружелюбный AI-ассистент, эксперт по страховым продуктам. Твоя задача — помочь сотруднику, ответив на его вопрос.

            ПРАВИЛА:
            1.  **Источник знаний**: Используй для ответа ТОЛЬКО И ИСКЛЮЧИТЕЛЬНО информацию из предоставленного ниже "ТЕКСТА ДОКУМЕНТА".
            2.  **Стиль ответа**: Давай подробный, но понятный ответ. Если уместно, объясни свою мысль на простом примере, основанном на тексте документа.
            3.  **Честность**: Если в документе нет ответа на вопрос, вежливо и прямо скажи: "К сожалению, в предоставленных материалах я не нашел точного ответа на этот вопрос." Не придумывай ничего от себя.
            4.  **Язык**: Отвечай на том же языке, на котором задан вопрос.

            ВОПРОС СОТРУДНИКА: "${question}"

            ТЕКСТ ДОКУМЕНТА ДЛЯ ПОИСКА ОТВЕТА:
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
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Не удалось получить ответ от ассистента. ' + error.message }),
        };
    }
};
