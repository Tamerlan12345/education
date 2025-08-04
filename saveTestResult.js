import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body);

    const { error } = await supabase
      .from('user_progress')
      // upsert = update or insert. Обновляет результат, если пользователь пересдал тест.
      .upsert({
        user_email: data.user_email,
        course_id: data.course_id,
        score: data.score,
        total_questions: data.total_questions,
        percentage: data.percentage,
        completed_at: new Date().toISOString(),
      }, { onConflict: 'user_email, course_id' }); // Ключ для поиска существующей записи

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Результат сохранен' }),
    };
  } catch (error) {
    console.error('Ошибка сохранения результата:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Не удалось сохранить результат.' }),
    };
  }
};
