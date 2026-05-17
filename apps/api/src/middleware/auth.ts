import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { supabaseAdmin } from '../db/client.js';
import { unauthorized } from '../shared/errors.js';
import type { AppUser, OrgMembership, RequestContext } from '../shared/context.js';
import { ensureAppUser } from '../domains/auth/auth.service.js';
import { loadOrgMembershipForUser, resolveStoredOrSingleAutoOrgContext } from '../domains/auth/active-organization.service.js';

const supabaseAuth = createClient(config.supabaseUrl, config.supabaseAnonKey);

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

  const dbEmail = typeof appUserRow.email === 'string' ? appUserRow.email.trim() : '';
  const jwtEmail = typeof authUser.email === 'string' ? authUser.email.trim() : '';
  const rawUiLang = typeof appUserRow.ui_language === 'string' ? appUserRow.ui_language.trim() : '';
  const uiLanguage = rawUiLang === 'he' ? 'he' : rawUiLang === 'en' ? 'en' : null;

  const user: AppUser = {
    id: appUserRow.id,
    authUserId: appUserRow.auth_user_id,
    // Prefer DB email; fall back to JWT so permission allowlists match the signed-in identity when users row is stale.
    email: dbEmail || jwtEmail,
    fullName: appUserRow.full_name,
    status: appUserRow.status,
    uiLanguage,
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

  req.context = {
    user,
    membership,
    organizationId,
  } as RequestContext;
  next();
}
