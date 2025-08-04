import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    try {
        const token = event.headers.authorization.split(' ')[1];
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) throw new Error('Unauthorized');

        const data = JSON.parse(event.body);
        const { error } = await supabase.from('user_progress').upsert({
            user_email: user.email,
            course_id: data.course_id,
            score: data.score,
            total_questions: data.total_questions,
            percentage: data.percentage,
            completed_at: new Date().toISOString(),
        }, { onConflict: 'user_email, course_id' }); 

        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ message: 'Результат сохранен' }) };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Не удалось сохранить результат.' }) };
    }
};
