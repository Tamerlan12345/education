import gaxios from 'gaxios';

export const handler = async (event) => {
    console.log("--- ЗАПУСК ТЕСТА GOOGLE API ---");

    const GOOGLE_API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
    
    // ID любого вашего файла с Google Drive с доступом по ссылке
    const TEST_FILE_ID = '17t84UoBfEHNBjOJKvlFNyHxGOiUTQON9'; 

    console.log("1. Чтение переменной окружения...");

    if (!GOOGLE_API_KEY || GOOGLE_API_KEY.length < 10) {
        const keyStatus = `Ключ ${!GOOGLE_API_KEY ? "НЕ НАЙДЕН" : "СЛИШКОМ КОРОТКИЙ"}.`;
        console.error("ПРОВАЛ:", keyStatus);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: "Критическая ошибка: Переменная окружения GOOGLE_SHEETS_API_KEY не найдена или неверна.",
                key_found: !!GOOGLE_API_KEY
            })
        };
    }

    console.log("2. Ключ GOOGLE_SHEETS_API_KEY успешно прочитан.");
    // В целях безопасности выводим только первые и последние 4 символа
    console.log(`   Ключ начинается с: ${GOOGLE_API_KEY.substring(0, 4)}...`);
    console.log(`   Ключ заканчивается на: ...${GOOGLE_API_KEY.substring(GOOGLE_API_KEY.length - 4)}`);

    const metaUrl = `https://www.googleapis.com/drive/v3/files/${TEST_FILE_ID}?fields=mimeType&key=${GOOGLE_API_KEY}`;
    
    try {
        console.log("3. Отправка тестового запроса в Google Drive API...");
        const metaResponse = await gaxios.request({ url: metaUrl });
        console.log("4. УСПЕХ! Google Drive API ответил. Ответ:", metaResponse.data);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "ТЕСТ УСПЕШНО ПРОЙДЕН! Соединение с Google API работает.",
                file_info: metaResponse.data
            })
        };
    } catch (error) {
        console.error("4. ПРОВАЛ! Ошибка при запросе к Google Drive API:", error.response ? error.response.data : error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: "ТЕСТ ПРОВАЛЕН. Не удалось подключиться к Google API.",
                error_details: error.response ? error.response.data : error.message
            })
        };
    }
};
