const gaxios = require('gaxios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Получаем ключи и ID из переменных окружения
const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Инициализируем Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Функция для поиска doc_id в нашей Google Таблице по id курса
async function getDocIdByCourseId(courseId) {
    // Запрашиваем все три столбца A, B, C
    const range = `Лист1!A2:C`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?key=${SHEETS_API_KEY}`;
    
    try {
        const response = await gaxios.request({ url });
        const rows = response.data.values;
        if (rows) {
            // Ищем строку, где значение в первой колонке (A) совпадает с id нашего курса
            const row = rows.find(r => r[0] === courseId);
            if (row && row[2]) {
                // Если строка найдена и в третьей колонке (C) есть значение, возвращаем его
                return row[2];
            }
        }
        return null; // Если ничего не найдено
    } catch (error) {
        console.error('Ошибка при чтении Google Таблицы:', error);
        throw new Error('Не удалось получить doc_id из таблицы.');
    }
}

// Эта функция УЖЕ РАБОТАЕТ и для Google Docs, и для PDF. Менять не нужно!
// Google API сам распознает, что это PDF, и выполнит OCR для извлечения текста.
async function getFileContentAsText(fileId) {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain&key=${SHEETS_API_KEY}`;
    try {
        const response = await gaxios.request({ url, responseType: 'text' });
        return response.data;
    } catch (error) {
        console.error('Ошибка при экспорте файла:', error.response ? error.response.data : error.message);
        throw new Error('Не удалось получить содержимое файла. Убедитесь, что доступ к файлу открыт по ссылке.');
    }
}

// Основной обработчик Netlify
exports.handler = async function (event, context) {
    const course_id = event.queryStringParameters.course_id;
    if (!course_id) {
        return { statusCode: 400, body: JSON.stringify({ error: 'course_id is required' }) };
    }
    
    try {
        // 1. Находим ID файла (PDF или Doc) по ID курса
        const doc_id = await getDocIdByCourseId(course_id);
        if (!doc_id) {
             return { statusCode: 404, body: JSON.stringify({ error: `Информация для курса '${course_id}' не найдена в таблице.` }) };
        }

        // 2. Получаем текстовое содержимое файла
        const fileContent = await getFileContentAsText(doc_id);
        
        // 3. Отправляем текст в Gemini (промпт остается тем же)
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
