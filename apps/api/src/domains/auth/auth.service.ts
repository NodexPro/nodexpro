import { createClient } from '@supabase/supabase-js';
import { config } from '../../config.js';
import { supabaseAdmin } from '../../db/client.js';
import { badRequest, conflict } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';

const supabaseAuth = createClient(config.supabaseUrl, config.supabaseAnonKey);

export async function register(params: { email: string; password: string; fullName?: string }) {
  const { data, error } = await supabaseAuth.auth.signUp({
    email: params.email,
    password: params.password,
    options: { data: { full_name: params.fullName ?? '' } },
  });
  if (error) {
    if (error.message.includes('already registered')) throw conflict('Email already registered');
    throw badRequest(error.message);
  }
  if (data.user) {
    const appUserId = await ensureAppUser(data.user.id, data.user.email ?? '', data.user.user_metadata?.full_name);
    if (appUserId) {
      await writeAudit({ organizationId: null, actorUserId: appUserId, entityType: 'user', action: AUDIT_ACTIONS.USER_CREATED, payload: { email: params.email } });
    }
  }
  return { session: data.session, user: data.user };
}

export async function login(params: { email: string; password: string }) {
  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email: params.email, password: params.password });
  if (error) throw badRequest('Invalid email or password');
  const appUser = await supabaseAdmin.from('users').select('id').eq('auth_user_id', data.user.id).single();
  if (appUser.data) {
    await supabaseAdmin.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', appUser.data.id);
    await writeAudit({ organizationId: null, actorUserId: appUser.data.id, entityType: 'user', action: AUDIT_ACTIONS.USER_LOGGED_IN, payload: { email: params.email } });
  }
  return { session: data.session, user: data.user };
}

export async function ensureAppUser(authUserId: string, email: string, fullName?: string) {
  const { data: existing } = await supabaseAdmin.from('users').select('id').eq('auth_user_id', authUserId).single();
  if (existing) return existing.id;
  const { data: created } = await supabaseAdmin
    .from('users')
    .insert({ auth_user_id: authUserId, email, full_name: fullName ?? null, status: 'active' })
    .select('id')
    .single();
  if (created) await writeAudit({ organizationId: null, actorUserId: created.id, entityType: 'user', action: AUDIT_ACTIONS.USER_CREATED, payload: { email } });
  return created?.id;
}
export const authService = {
  register,
  login,
  ensureAppUser
};
