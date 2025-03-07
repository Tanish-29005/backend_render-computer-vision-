// supabaseClient.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://xjxdqllrlhvnjeosnovi.supabase.co';  // Replace with your Supabase URL
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeGRxbGxybGh2bmplb3Nub3ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk2NDY3NzMsImV4cCI6MjA1NTIyMjc3M30.qfNerrx0o78wG9JmxbZw8RzKZRCAoLWsVBgxOMyzdbI';  // Replace with your API key

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default supabase;
