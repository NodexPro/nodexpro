import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

export const supabaseAdmin: SupabaseClient = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  { auth: { persistSession: false } }
);
