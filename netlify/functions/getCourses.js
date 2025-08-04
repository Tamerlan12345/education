import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export const handler = async (event) => {
  const user_email = event.queryStringParameters.user_email;

  try {
    // Получаем все курсы
    const { data: coursesData, error: coursesError } = await supabase
      .from('courses')
      .select('course_id, title');
      
    if (coursesError) throw coursesError;

    // Получаем прогресс конкретного пользователя
    let userProgress = {};
    if (user_email) {
      const { data: progressData, error: progressError } = await supabase
        .from('user_progress')
        .select('course_id, percentage')
        .eq('user_email', user_email);

      if (progressError) throw progressError;
      
      // Преобразуем прогресс в удобный формат { course_id: { ... } }
      progressData.forEach(p => {
        userProgress[p.course_id] = { completed: true, percentage: p.percentage };
      });
    }

    const courses = coursesData.map(course => ({
      id: course.course_id,
      title: course.title,
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courses, userProgress }),
    };
  } catch (error) {
    console.error("Ошибка при получении курсов из Supabase:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch courses from Supabase.' }),
    };
  }
};
