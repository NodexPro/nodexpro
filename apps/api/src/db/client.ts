import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { timedFetch } from '../shared/request-timing.js';

export const supabaseAdmin: SupabaseClient = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  // `timedFetch` only adds per-request call accounting for the Server-Timing header (measurement, no behavior).
  { auth: { persistSession: false }, global: { fetch: timedFetch } }
);
