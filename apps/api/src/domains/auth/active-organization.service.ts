import { supabaseAdmin } from '../../db/client.js';
import { supabaseEmbedOne } from '../../shared/supabase-embed.js';
import type { OrgMembership } from '../../shared/context.js';
import { loadMembershipWithPermissions, mergeLegacyOrganizationUserPermissions } from '../rbac/rbac.service.js';
import {
  getCanonicalMembershipStatus,
  mayUseLegacyOrganizationUsersAccessFallback,
} from '../memberships/organization-membership-access.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getUserStoredActiveOrganizationId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('users').select('active_organization_id').eq('id', userId).maybeSingle();
  const v = (data as { active_organization_id?: string | null } | null)?.active_organization_id;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return UUID_RE.test(t) ? t : null;
}

export async function updateUserStoredActiveOrganizationId(userId: string, organizationId: string | null): Promise<void> {
  await supabaseAdmin
    .from('users')
    .update({ active_organization_id: organizationId, updated_at: new Date().toISOString() })
    .eq('id', userId);
}

/**
 * Active org ids for a user.
 * Canonical `organization_memberships` wins. Legacy `organization_users` is only consulted
 * for orgs with NO memberships row (never when canonical status is revoked).
 */
export async function listUserActiveOrganizationIds(userId: string): Promise<string[]> {
  const { data: membershipRows } = await supabaseAdmin
    .from('organization_memberships')
    .select('organization_id, status')
    .eq('user_id', userId);

  const ids = new Set<string>();
  const canonicalOrgIds = new Set<string>();
  for (const r of membershipRows ?? []) {
    const orgId = String((r as { organization_id: string }).organization_id ?? '');
    if (!orgId) continue;
    canonicalOrgIds.add(orgId);
    if ((r as { status: string }).status === 'active') ids.add(orgId);
  }

  const ou = await supabaseAdmin
    .from('organization_users')
    .select('organization_id')
    .eq('user_id', userId)
    .eq('membership_status', 'active');
  for (const r of ou.data ?? []) {
    const orgId = String((r as { organization_id: string }).organization_id ?? '');
    if (!orgId) continue;
    // P0: never restore access via legacy row when canonical membership exists.
    if (canonicalOrgIds.has(orgId)) continue;
    ids.add(orgId);
  }
  return [...ids];
}

export async function loadOrgMembershipForUser(userId: string, organizationId: string): Promise<OrgMembership | null> {
  const m = await loadMembershipWithPermissions(userId, organizationId);
  if (m) {
    return {
      organizationId: m.organizationId,
      userId: m.userId,
      roleId: '',
      roleCode: m.roleCode,
      permissions: m.permissions,
    };
  }

  // Canonical row exists but is not active (e.g. revoked) → deny. Do NOT fall back to OU.
  const canonical = await getCanonicalMembershipStatus(userId, organizationId);
  if (canonical.status !== 'absent') {
    return null;
  }

  if (!(await mayUseLegacyOrganizationUsersAccessFallback(userId, organizationId))) {
    return null;
  }

  const { data: ou } = await supabaseAdmin
    .from('organization_users')
    .select('organization_id, user_id, role_id, roles(code, role_permissions(permissions(code)))')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .eq('membership_status', 'active')
    .single();
  if (!ou) return null;
  type RoleRow = { code: string; role_permissions?: Array<{ permissions: { code: string } | null }> };
  const role = supabaseEmbedOne(ou.roles as unknown as RoleRow | RoleRow[] | null);
  const rp = role?.role_permissions ?? [];
  const directPerms = rp.map((x: { permissions?: { code: string } | null }) => x.permissions?.code).filter((c): c is string => !!c);
  const permissions = await mergeLegacyOrganizationUserPermissions(role?.code ?? '', directPerms);
  return {
    organizationId: ou.organization_id,
    userId: ou.user_id,
    roleId: '',
    roleCode: role?.code ?? '',
    permissions,
  };
}

/**
 * When the request has no valid explicit org header: use persisted preference, repair invalid rows,
 * auto-persist single-org tenants.
 */
export async function resolveStoredOrSingleAutoOrgContext(userId: string): Promise<{
  organizationId: string | null;
  membership: OrgMembership | null;
}> {
  const stored = await getUserStoredActiveOrganizationId(userId);
  if (stored) {
    const m = await loadOrgMembershipForUser(userId, stored);
    if (m) return { organizationId: stored, membership: m };
    await updateUserStoredActiveOrganizationId(userId, null);
  }
  const orgIds = await listUserActiveOrganizationIds(userId);
  if (orgIds.length === 1) {
    const id = orgIds[0];
    await updateUserStoredActiveOrganizationId(userId, id);
    const m = await loadOrgMembershipForUser(userId, id);
    return { organizationId: id, membership: m };
  }
  return { organizationId: null, membership: null };
}
