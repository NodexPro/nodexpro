import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { supabaseAdmin } from '../db/client.js';
import { unauthorized } from '../shared/errors.js';
import { timedFetch } from '../shared/request-timing.js';
import type { AppUser, OrgMembership, RequestContext } from '../shared/context.js';
import { ensureAppUser } from '../domains/auth/auth.service.js';
import { loadOrgMembershipForUser, resolveStoredOrSingleAutoOrgContext } from '../domains/auth/active-organization.service.js';
import {
  APP_USER_NOT_ACTIVE_CODE,
  APP_USER_NOT_ACTIVE_MESSAGE,
  isAppUserStatusActive,
} from '../domains/auth/user-authorization.pure.js';
import { readAuthenticatorAssurance } from '../shared/privileged-mfa.pure.js';
import { getPrivilegedMfaGate } from '../shared/privileged-mfa-gate.js';
import { deviceCredentialFromCookie } from '../domains/auth/mfa-trusted-device.pure.js';
import { recognizeTrustedDevice } from '../domains/auth/mfa-trusted-device.service.js';

// `timedFetch` only adds per-request call accounting for the Server-Timing header (measurement, no behavior).
const supabaseAuth = createClient(config.supabaseUrl, config.supabaseAnonKey, { global: { fetch: timedFetch } });

export async function authMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    next(unauthorized('Missing or invalid Authorization header'));
    return;
  }

  const { data: { user: authUser }, error } = await supabaseAuth.auth.getUser(token);
  if (error || !authUser) {
    next(unauthorized('Invalid or expired token'));
    return;
  }

  let appUserRow = (
    await supabaseAdmin
      .from('users')
      .select('id, auth_user_id, email, full_name, status, ui_language')
      .eq('auth_user_id', authUser.id)
      .single()
  ).data;
  if (!appUserRow) {
    try {
      await ensureAppUser(authUser.id, authUser.email ?? '', authUser.user_metadata?.full_name);
      appUserRow = (
        await supabaseAdmin
          .from('users')
          .select('id, auth_user_id, email, full_name, status, ui_language')
          .eq('auth_user_id', authUser.id)
          .single()
      ).data ?? null;
    } catch {
      // ignore
    }
  }
  if (!appUserRow) {
    next(unauthorized('Application user not found'));
    return;
  }

  // Re-read users.status every request. A valid JWT must not keep a suspended/deleted account authorized.
  if (!isAppUserStatusActive(appUserRow.status)) {
    next(unauthorized(APP_USER_NOT_ACTIVE_MESSAGE, APP_USER_NOT_ACTIVE_CODE));
    return;
  }

  const dbEmail = typeof appUserRow.email === 'string' ? appUserRow.email.trim() : '';
  const jwtEmail = typeof authUser.email === 'string' ? authUser.email.trim() : '';
  const rawUiLang = typeof appUserRow.ui_language === 'string' ? appUserRow.ui_language.trim() : '';
  const uiLanguage = /^[a-z]{2}(-[A-Z]{2})?$/.test(rawUiLang) ? rawUiLang : null;

  const user: AppUser = {
    id: appUserRow.id,
    authUserId: appUserRow.auth_user_id,
    // Prefer DB email; fall back to JWT so permission allowlists match the signed-in identity when users row is stale.
    email: dbEmail || jwtEmail,
    fullName: appUserRow.full_name,
    status: appUserRow.status,
    uiLanguage,
    emailVerified: Boolean(authUser.email_confirmed_at),
  };

  const rawOrgHeader = req.headers['x-organization-id'];
  const orgIdHeader = typeof rawOrgHeader === 'string' && rawOrgHeader.trim() ? rawOrgHeader.trim() : undefined;
  let membership: OrgMembership | null = null;
  let organizationId: string | null = null;

  if (orgIdHeader) {
    membership = await loadOrgMembershipForUser(user.id, orgIdHeader);
    if (membership) organizationId = membership.organizationId;
  }

  if (!organizationId) {
    const resolved = await resolveStoredOrSingleAutoOrgContext(user.id);
    organizationId = resolved.organizationId;
    membership = resolved.membership;
  }

  const deviceCredential = deviceCredentialFromCookie(typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined);
  let trustedDevice = false;
  if (deviceCredential && getPrivilegedMfaGate().trustedDevicesReady) {
    trustedDevice = await recognizeTrustedDevice(user.id, deviceCredential).catch(() => false);
  }

  let suspiciousSignIn = false;
  const ownerEmail = config.platformOwner.email?.trim().toLowerCase() ?? '';
  if (ownerEmail && user.email.trim().toLowerCase() === ownerEmail && !membership?.roleCode) {
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const found = await supabaseAdmin
      .from('audit_log')
      .select('id', { head: true, count: 'exact' })
      .eq('actor_user_id', user.id)
      .eq('action', 'security.suspicious_sign_in')
      .gte('created_at', since);
    suspiciousSignIn = !found.error && (found.count ?? 0) > 0;
  }

  req.context = {
    user,
    membership,
    organizationId,
    correlationId: req.correlationId,
    authenticatorAssurance: readAuthenticatorAssurance(token),
    trustedDevice,
    suspiciousSignIn,
  } as RequestContext;
  next();
}
