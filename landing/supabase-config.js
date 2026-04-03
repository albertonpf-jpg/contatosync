// ============================================
// SUPABASE CONFIG - Landing Page
// ============================================

const SUPABASE_URL = 'https://uznrpziouttnncozxpvf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6bnJwemlvdXR0bm5jb3p4cHZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NTc1OTQsImV4cCI6MjA5MDEzMzU5NH0.o3DH-R2JsI68BhECBAx-s5pEL6qXqNAgQpPpUq0rzZk';

// Inicializar cliente Supabase
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
