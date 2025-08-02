const gaxios = require('gaxios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pdf = require('pdf-parse');

// Получаем ключи и ID из переменных окружения
const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Инициализируем Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Функция для поиска doc_id в нашей Google Таблице по id курса
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

// Обновленная функция для получения контента.
// Теперь она универсальна: читает и Google Docs, и PDF.
async function getFileContentAsText(fileId) {
    // Сначала пытаемся экспортировать как Google Doc
    const exportUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain&key=${SHEETS_API_KEY}`;
    try {
        const response = await gaxios.request({ url: exportUrl, responseType: 'text' });
        return response.data; // Успешно, это был Google Doc
    } catch (exportError) {
        // Если экспорт не удался, значит, это, скорее всего, PDF. Пытаемся его скачать.
        console.log('Не удалось экспортировать файл, пробую скачать как PDF...');
        const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${SHEETS_API_KEY}`;
        try {
            const response = await gaxios.request({ url: downloadUrl, responseType: 'arraybuffer' });
            const data = await pdf(response.data);
            return data.text; // Успешно, извлекли текст из PDF
        } catch (downloadError) {
            console.error('Ошибка при скачивании и парсинге PDF:', downloadError);
            throw new Error('Не удалось прочитать файл. Файл не является ни Google Документом, ни PDF, или доступ к нему закрыт.');
        }
    }
}

// Основной обработчик Netlify
exports.handler = async function (event, context) {
    const course_id = event.queryStringParameters.course_id;
    if (!course_id) {
        return { statusCode: 400, body: JSON.stringify({ error: 'course_id is required' }) };
    }
    
    try {
        const doc_id = await getDocIdByCourseId(course_id);
        if (!doc_id) {
             return { statusCode: 404, body: JSON.stringify({ error: `Информация для курса '${course_id}' не найдена в таблице.` }) };
        }

        const fileContent = await getFileContentAsText(doc_id);
        
        const prompt = `
            Ты — методолог и эксперт по страхованию. Проанализируй следующий текст из внутреннего документа компании.
            Твоя задача — создать на его основе обучающий модуль для сотрудника.
            Верни результат СТРОГО в формате JSON. Не добавляй никаких других слов или markdown форматирования до или после JSON.
            JSON должен иметь следующую структуру:
            {
              "summary": "HTML-форматированный текст с кратким содержанием документа. Используй теги <h2>, <h3>, <p>, <ul> и <li> для структурирования.",
              "questions": [
                {
                  "question": "Текст первого вопроса",
                  "options": ["Вариант ответа 1", "Вариант ответа 2", "Вариант ответа 3"],
                  "correct_option_index": 0
                }
              ]
            }
            Создай ровно 5 вопросов.
            
            Вот текст документа:
            ---
            ${fileContent}
            ---
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        const jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const data = JSON.parse(jsonString);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        };

    } catch (error) {
        console.error("Ошибка при обработке контента курса:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Не удалось сгенерировать контент курса. ' + error.message }),
        };
    }
};
