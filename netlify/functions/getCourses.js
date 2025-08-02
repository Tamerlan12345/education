const gaxios = require('gaxios');

exports.handler = async function (event, context) {
    const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
    const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Лист1!A2:B?key=${API_KEY}`;

    try {
        const response = await gaxios.request({ url });
        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return {
                statusCode: 200,
                body: JSON.stringify([]),
            };
        }

        const courses = rows.map(row => ({
            id: row[0],
            title: row[1],
            // Мы берем doc_id из другого столбца, когда запрашиваем контент
            doc_id: '' 
        }));

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(courses),
        };
    } catch (error) {
        console.error(error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to fetch courses' }),
        };
    }
};
