/**
 * Canonical organization membership access helpers.
 *
 * Source of truth: `organization_memberships`.
 * Legacy `organization_users` is compatibility-only and must never override a
 * revoked/non-active canonical membership for the same (org, user).
 */

import { supabaseAdmin } from '../../db/client.js';
import { forbidden } from '../../shared/errors.js';
import { supabaseEmbedOne } from '../../shared/supabase-embed.js';

/** Permissions that qualify an active member as a Client Operations handler (מטפל בתיק). */
export const HANDLER_ELIGIBILITY_PERMISSION_CODES = [
  'client_operations.edit',
  'edit_clients',
] as const;

export type OrgHandlerOption = {
  user_id: string;
  email: string;
  display_name: string;
  role_code: string;
};

async function loadHandlerEligibleRoleCodes(): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from('rbac_role_permissions')
    .select('role_code, permission_code')
    .in('permission_code', [...HANDLER_ELIGIBILITY_PERMISSION_CODES]);
  if (error) throw new Error(error.message ?? 'Failed to load handler-eligible roles');
  const roles = new Set<string>();
  for (const row of data ?? []) {
    const code = String((row as { role_code?: string }).role_code ?? '').trim();
    if (code) roles.add(code);
  }
  // Fail-closed safety: never treat empty matrix as "everyone".
  if (!roles.size) {
    roles.add('owner');
    roles.add('admin');
    roles.add('staff');
  }
  return roles;
}

/**
 * Active canonical memberships for an org whose role grants handler-capable permissions.
 * Single source for CO handler options + update_profile validation.
 */
export async function listActiveHandlerEligibleMembers(organizationId: string): Promise<OrgHandlerOption[]> {
  const eligibleRoles = await loadHandlerEligibleRoleCodes();
  const { data, error } = await supabaseAdmin
    .from('organization_memberships')
    .select('user_id, role_code, users(id, email, full_name)')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .in('role_code', [...eligibleRoles]);
  if (error) throw new Error(error.message ?? 'Failed to list handler-eligible members');

  type UserEmbed = { id: string; email: string | null; full_name: string | null };
  type Row = {
    user_id: string;
    role_code: string;
    users: UserEmbed | UserEmbed[] | null;
  };

  const out: OrgHandlerOption[] = [];
  for (const row of (data ?? []) as unknown as Row[]) {
    if (!eligibleRoles.has(row.role_code)) continue;
    const u = supabaseEmbedOne(row.users);
    if (!u || !row.user_id) continue;
    const email = (u.email ?? '').trim();
    const display_name = u.full_name?.trim() ? u.full_name.trim() : email;
    if (!email || !display_name) continue;
    out.push({
      user_id: row.user_id,
      email,
      display_name,
      role_code: row.role_code,
    });
  }
  return out.sort((a, b) => a.display_name.localeCompare(b.display_name, 'he'));
}

export async function assertUserIsActiveHandlerEligible(
  organizationId: string,
  userId: string,
): Promise<void> {
  const eligible = await listActiveHandlerEligibleMembers(organizationId);
  if (!eligible.some((m) => m.user_id === userId)) {
    throw forbidden('Assigned handler must be an active organization member with client-handling access');
  }
}

/** Display labels for any user ids (including revoked) — attribution, not eligibility. */
export async function loadMemberDisplayNamesByUserIds(
  userIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email, full_name')
    .in('id', unique);
  if (error) throw new Error(error.message ?? 'Failed to load user display names');
  for (const row of (data ?? []) as Array<{ id: string; email: string | null; full_name: string | null }>) {
    const display = row.full_name?.trim() ? row.full_name.trim() : (row.email ?? '').trim();
    if (row.id && display) map.set(row.id, display);
  }
  return map;
}

export type CanonicalMembershipStatus = 'active' | 'invited' | 'revoked' | 'absent';

/** Status of the canonical memberships row for (org, user), if any. */
export async function getCanonicalMembershipStatus(
  userId: string,
  organizationId: string,
): Promise<{ status: CanonicalMembershipStatus; role_code: string | null }> {
  const { data } = await supabaseAdmin
    .from('organization_memberships')
    .select('status, role_code')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (!data) return { status: 'absent', role_code: null };
  const status = String((data as { status: string }).status ?? '');
  const role_code = String((data as { role_code?: string }).role_code ?? '') || null;
  if (status === 'active' || status === 'invited' || status === 'revoked') {
    return { status, role_code };
  }
  return { status: 'revoked', role_code };
}

/**
 * Whether legacy organization_users may be used as access fallback for this pair.
 * Never when a canonical memberships row exists (including revoked).
 */
export async function mayUseLegacyOrganizationUsersAccessFallback(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const { status } = await getCanonicalMembershipStatus(userId, organizationId);
  return status === 'absent';
}

/**
 * Compatibility sync: keep organization_users aligned after canonical membership writes.
 * Does not emit a second user-facing membership audit event.
 */
export async function syncLegacyOrganizationUserFromCanonical(params: {
  organizationId: string;
  userId: string;
  roleCode: string;
  membershipStatus: 'active' | 'removed';
  invitedBy?: string | null;
}): Promise<void> {
  const { data: roleRow } = await supabaseAdmin
    .from('roles')
    .select('id')
    .eq('code', params.roleCode)
    .maybeSingle();
  if (!roleRow) {
    // Fall back to staff role id if custom mapping missing.
    const { data: staff } = await supabaseAdmin.from('roles').select('id').eq('code', 'staff').maybeSingle();
    if (!staff) return;
    await upsertLegacyOrganizationUser({
      ...params,
      roleId: (staff as { id: string }).id,
    });
    return;
  }
  await upsertLegacyOrganizationUser({
    ...params,
    roleId: (roleRow as { id: string }).id,
  });
}

async function upsertLegacyOrganizationUser(params: {
  organizationId: string;
  userId: string;
  roleId: string;
  membershipStatus: 'active' | 'removed';
  invitedBy?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  const { data: existing } = await supabaseAdmin
    .from('organization_users')
    .select('id, invited_by')
    .eq('organization_id', params.organizationId)
    .eq('user_id', params.userId)
    .maybeSingle();

  if (existing) {
    const patch: Record<string, unknown> = {
      role_id: params.roleId,
      membership_status: params.membershipStatus,
      updated_at: now,
    };
    if (params.invitedBy !== undefined && params.invitedBy !== null) {
      patch.invited_by = params.invitedBy;
    }
    await supabaseAdmin
      .from('organization_users')
      .update(patch)
      .eq('id', (existing as { id: string }).id);
    return;
  }

  if (params.membershipStatus !== 'active') return;

  await supabaseAdmin.from('organization_users').insert({
    organization_id: params.organizationId,
    user_id: params.userId,
    role_id: params.roleId,
    membership_status: 'active',
    invited_by: params.invitedBy ?? null,
    joined_at: now,
    created_at: now,
    updated_at: now,
  });
}
