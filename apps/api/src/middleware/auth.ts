import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { supabaseAdmin } from '../db/client.js';
import { unauthorized } from '../shared/errors.js';
import type { AppUser, OrgMembership, RequestContext } from '../shared/context.js';
import { ensureAppUser } from '../domains/auth/auth.service.js';
import { supabaseEmbedOne } from '../shared/supabase-embed.js';

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

  let appUserRow = (await supabaseAdmin.from('users').select('id, auth_user_id, email, full_name, status').eq('auth_user_id', authUser.id).single()).data;
  if (!appUserRow) {
    try {
      await ensureAppUser(authUser.id, authUser.email ?? '', authUser.user_metadata?.full_name);
      appUserRow = (await supabaseAdmin.from('users').select('id, auth_user_id, email, full_name, status').eq('auth_user_id', authUser.id).single()).data ?? null;
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
  const user: AppUser = {
    id: appUserRow.id,
    authUserId: appUserRow.auth_user_id,
    // Prefer DB email; fall back to JWT so permission allowlists match the signed-in identity when users row is stale.
    email: dbEmail || jwtEmail,
    fullName: appUserRow.full_name,
    status: appUserRow.status,
  };

  const orgId = req.headers['x-organization-id'] as string | undefined;
  let membership: OrgMembership | null = null;
  let organizationId: string | null = null;

  if (orgId) {
    const { loadMembershipWithPermissions } = await import('../domains/rbac/rbac.service.js');
    let m = await loadMembershipWithPermissions(user.id, orgId);
    if (!m) {
      const { data: ou } = await supabaseAdmin
        .from('organization_users')
        .select('organization_id, user_id, role_id, roles(code, role_permissions(permissions(code)))')
        .eq('organization_id', orgId)
        .eq('user_id', user.id)
        .eq('membership_status', 'active')
        .single();
      if (ou) {
        type RoleRow = { code: string; role_permissions?: Array<{ permissions: { code: string } | null }> };
        const role = supabaseEmbedOne(ou.roles as unknown as RoleRow | RoleRow[] | null);
        const rp = role?.role_permissions ?? [];
        const directPerms = rp
          .map((x: { permissions?: { code: string } | null }) => x.permissions?.code)
          .filter((c): c is string => !!c);
        const { mergeLegacyOrganizationUserPermissions } = await import('../domains/rbac/rbac.service.js');
        const permissions = await mergeLegacyOrganizationUserPermissions(role?.code ?? '', directPerms);
        m = {
          organizationId: ou.organization_id,
          userId: ou.user_id,
          roleCode: role?.code ?? '',
          permissions,
        };
      }
    }
    if (m) {
      membership = {
        organizationId: m.organizationId,
        userId: m.userId,
        roleId: '',
        roleCode: m.roleCode,
        permissions: m.permissions,
      };
      organizationId = m.organizationId;
    }
  }

  req.context = {
    user,
    membership,
    organizationId,
  } as RequestContext;
  next();
}
