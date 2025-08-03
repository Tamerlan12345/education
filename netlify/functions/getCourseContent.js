const gaxios = require('gaxios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pdf = require('pdf-parse');

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

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
    const course_id = event.queryStringParameters.course_id;
    if (!course_id) {
        return { statusCode: 400, body: JSON.stringify({ error: 'course_id is required' }) };
    }
    
    try {
        const doc_id = await getDocIdByCourseId(course_id);
        if (!doc_id) {
             return { statusCode: 404, body: JSON.stringify({ error: `Информация для курса '${course_id}' не найдена.` }) };
        }
        const fileContent = await getFileContentAsText(doc_id);
        
        // --- ОБНОВЛЕННЫЙ ПРОМПТ ---
        const prompt = `
            Задание: Ты — опытный AI-наставник в страховой компании. Твоя задача — создать подробный и понятный обучающий модуль на основе внутреннего документа. Каждый раз старайся объяснять материал немного по-разному, используя разные примеры и аналогии, но оставаясь СТРОГО в рамках предоставленного текста.

            Требования к плану обучения:
            1.  **Структура**: Разбей обучение на логические блоки с заголовками <h2>. Например: "Что страхуем?", "Ключевые риски", "Важные исключения".
            2.  **Глубина**: В каждом блоке подробно раскрой тему, используя подзаголовки <h3> и списки <ul>/<li>. Объясняй сложные термины простыми словами.
            3.  **Контент**: Вся без исключения информация должна быть взята из "ТЕКСТА ДОКУМЕНТА ДЛЯ ОБРАБОТКИ". Не добавляй ничего от себя.
            4.  **Тесты**: Создай ровно 5 вопросов для проверки, которые затрагивают самые важные аспекты документа.

            Требования к формату вывода:
            - Верни результат СТРОГО в формате JSON.
            - Не добавляй никаких слов или markdown-разметки до или после JSON-объекта.
            - Структура JSON должна быть следующей:
            {
              "summary": "HTML-форматированный текст подробного плана обучения.",
              "questions": [
                {
                  "question": "Текст вопроса",
                  "options": ["Вариант 1", "Вариант 2", "Вариант 3"],
                  "correct_option_index": 0
                }
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
            body: JSON.stringify({ error: 'Не удалось сгенерировать контент. ' + error.message }),
        };
    }
};
