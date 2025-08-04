import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export const handler = async (event) => {
  try {
    const token = event.headers.authorization.split(' ')[1];
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error('Unauthorized');
    
    const user_email = user.email;
    const { data: coursesData, error: coursesError } = await supabase.from('courses').select('course_id, title');
    if (coursesError) throw coursesError;

    let userProgress = {};
    const { data: progressData, error: progressError } = await supabase.from('user_progress').select('course_id').eq('user_email', user_email);
    if (progressError) throw progressError;
    
    progressData.forEach(p => { userProgress[p.course_id] = { completed: true }; });

    const courses = coursesData.map(course => ({ id: course.course_id, title: course.title }));

    return { statusCode: 200, body: JSON.stringify({ courses, userProgress }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
