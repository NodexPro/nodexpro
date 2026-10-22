import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { timedFetch } from '../shared/request-timing.js';

/**
 * Service-role client. BYPASSRLS — RLS never applies to these queries.
 * Tenant isolation and RBAC must be enforced in application code (organization_id from
 * membership-checked context, requireOrg / requirePermission). Do not treat RLS as a
 * backup for this client.
 */
export const supabaseAdmin: SupabaseClient = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  // `timedFetch` only adds per-request call accounting for the Server-Timing header (measurement, no behavior).
  { auth: { persistSession: false }, global: { fetch: timedFetch } }
);
