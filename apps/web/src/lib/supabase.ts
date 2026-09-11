import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export function supabaseHostForDiagnostics(): string {
  try {
    return supabaseUrl ? new URL(supabaseUrl).host : '(missing VITE_SUPABASE_URL)';
  } catch {
    return '(invalid VITE_SUPABASE_URL)';
  }
}

export const supabase = createClient(supabaseUrl, anonKey);
