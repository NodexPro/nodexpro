import { createClient } from '@supabase/supabase-js';
import { config } from '../../config.js';
import { supabaseAdmin } from '../../db/client.js';
import { badRequest, unauthorized } from '../../shared/errors.js';
import { ENUMERATION_SAFE_REGISTER_MESSAGE } from '../../shared/api-security.pure.js';
import { APP_USER_NOT_ACTIVE_CODE, APP_USER_NOT_ACTIVE_MESSAGE, isAppUserStatusActive } from './user-authorization.pure.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import { allowedPasswordResetRedirect, normalizePasswordResetEmail, publicPasswordResetResponse } from './password-reset.pure.js';
import { maskAttemptedIdentifier } from '../../shared/failed-login-policy.pure.js';

const supabaseAuth = createClient(config.supabaseUrl, config.supabaseAnonKey);

export async function register(params: { email: string; password: string; fullName?: string }) {
  const { data, error } = await supabaseAuth.auth.signUp({
    email: params.email,
    password: params.password,
    options: { data: { full_name: params.fullName ?? '' } },
  });
  if (error) {
    if (error.message.includes('already registered')) throw badRequest(ENUMERATION_SAFE_REGISTER_MESSAGE);
    throw badRequest(ENUMERATION_SAFE_REGISTER_MESSAGE);
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
  const { resolveLoginIdentifier } = await import('../account-security/account-security.service.js');
  const canonicalEmail = await resolveLoginIdentifier(params.email);
  const { data, error } = await supabaseAuth.auth.signInWithPassword({
    email: canonicalEmail,
    password: params.password,
  });
  if (error) throw badRequest('Invalid email or password');
  const appUser = await supabaseAdmin.from('users').select('id, status').eq('auth_user_id', data.user.id).single();
  if (appUser.data && !isAppUserStatusActive(appUser.data.status)) {
    const issued = data.session?.access_token;
    if (issued) await supabaseAuth.auth.admin.signOut(issued).catch(() => {});
    throw unauthorized(APP_USER_NOT_ACTIVE_MESSAGE, APP_USER_NOT_ACTIVE_CODE);
  }
  if (appUser.data) {
    await supabaseAdmin.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', appUser.data.id);
    await writeAudit({
      organizationId: null,
      actorUserId: appUser.data.id,
      entityType: 'user',
      action: AUDIT_ACTIONS.USER_LOGGED_IN,
      payload: { identifier_kind: canonicalEmail === params.email.trim().toLowerCase() ? 'primary' : 'additional' },
    });
  }
  return { session: data.session, user: data.user, appUserId: appUser.data?.id ?? null };
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
export async function requestPasswordReset(params: {
  email: string;
  redirectTo?: string | null;
}): Promise<{ ok: true; requested: true }> {
  const identifier = normalizePasswordResetEmail(params.email);
  const allowedOrigins = [process.env.APP_URL, process.env.FRONTEND_URL, 'http://localhost:5173']
    .filter((item): item is string => Boolean(item));
  const redirectTo = allowedPasswordResetRedirect({
    requested: params.redirectTo,
    allowedOrigins,
  });
  if (identifier) {
    try {
      const { resolveLoginIdentifier } = await import('../account-security/account-security.service.js');
      const canonicalEmail = await resolveLoginIdentifier(identifier);
      await supabaseAuth.auth.resetPasswordForEmail(canonicalEmail, { redirectTo });
    } catch {
      // Public response stays identical whether the mailbox exists.
    }
    await writeAudit({
      organizationId: null,
      actorUserId: null,
      entityType: 'security',
      action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET_REQUESTED,
      payload: { masked_target: maskAttemptedIdentifier(identifier) },
    }).catch(() => undefined);
  }
  return publicPasswordResetResponse();
}

export const authService = {
  register,
  login,
  ensureAppUser,
  requestPasswordReset,
};
