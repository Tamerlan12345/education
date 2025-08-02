const gaxios = require('gaxios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Получаем ID листа из переменной окружения
const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY;

// Инициализируем Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Функция для получения doc_id из таблицы по course_id
async function getDocIdByCourseId(courseId) {
    const range = `Лист1!A2:C`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?key=${SHEETS_API_KEY}`;
    try {
        const response = await gaxios.request({ url });
        const rows = response.data.values;
        if (rows) {
            const row = rows.find(r => r[0] === courseId);
            if (row && row[2]) {
                return row[2]; // Возвращаем doc_id из третьего столбца
            }
        }
        return null;
    } catch (error) {
        console.error('Error fetching from Google Sheets:', error);
        throw new Error('Could not retrieve doc_id from Sheets.');
    }
}


// Функция для получения текста из Google Документа
async function getGoogleDocContent(docId) {
    const url = `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain&key=${SHEETS_API_KEY}`;
    try {
        const response = await gaxios.request({ url, responseType: 'text' });
        return response.data;
    } catch (error) {
        console.error('Error fetching Google Doc content:', error.response ? error.response.data : error.message);
        throw new Error('Could not retrieve document content.');
    }
}

// Основной обработчик Netlify
exports.handler = async function (event, context) {
    // Получаем ID курса из запроса, чтобы найти doc_id
    const course_id = event.queryStringParameters.course_id;
    if (!course_id) {
        return { statusCode: 400, body: JSON.stringify({ error: 'course_id is required' }) };
    }
    
    try {
        const doc_id = await getDocIdByCourseId(course_id);
        if (!doc_id) {
             return { statusCode: 404, body: JSON.stringify({ error: `doc_id for course ${course_id} not found` }) };
        }

        const docContent = await getGoogleDocContent(doc_id);
        
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
                },
                {
                  "question": "Текст второго вопроса",
                  "options": ["Вариант A", "Вариант B", "Вариант C"],
                  "correct_option_index": 2
                }
              ]
            }
            Создай ровно 5 вопросов.
            
            Вот текст документа:
            ---
            ${docContent}
            ---
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        // Попытка "очистить" ответ от лишних символов
        const jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const data = JSON.parse(jsonString);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        };

    } catch (error) {
        console.error("Error processing course content:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to generate course content. ' + error.message }),
        };
    }
};
