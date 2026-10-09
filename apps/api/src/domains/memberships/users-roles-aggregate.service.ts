/**
 * Stage 5.6 — Users & Roles: ONE backend-owned aggregate + the profile / close-access commands.
 *
 * The aggregate returns UI-ready member rows. The frontend renders them as-is; it never derives an
 * action, label, count or summary from a role code, and never stitches per-member reads.
 *
 * Truth sources reused (nothing new is authorized here):
 *  - membership status / role / joined_at     organization_memberships
 *  - client access                            Stage 5.1 resolver (resolveOrganizationClientAccessScope)
 *  - module access                            Stage 5.4/5.5 effective member modules
 *  - profile                                  organization_member_profiles (sparse, Stage 5.6)
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { supabaseEmbedOne } from '../../shared/supabase-embed.js';
import { RBAC_PERMISSIONS, requireRbacPermission } from '../rbac/rbac.service.js';
import {
  resolveOrganizationClientAccessScope,
  roleHasOfficeClientAccess,
} from '../client-operations/organization-client-access.js';
import {
  loadEnabledMemberModuleIdSet,
  loadOrganizationAssignableModuleNames,
} from '../modules/member-module-access.service.js';
import { listInvitesRbac, revokeUserAccessRbac } from './memberships-rbac.service.js';
import { loadCloseAccessBlockers } from './member-close-access-blockers.service.js';
import {
  buildClientAccessProjection,
  buildModuleAccessProjection,
  computeMemberActions,
  hasCloseAccessBlockers,
  normalizeMemberProfileInput,
  resolveInvitationStatus,
  resolveMemberDisplayName,
  resolveMemberStatus,
  resolveRoleLabel,
  toDateOnly,
  type ClientAccessProjection,
  type CloseAccessBlockers,
  type MemberActions,
  type ModuleAccessProjection,
} from './users-roles.pure.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, staff: 2, viewer: 3 };

export type UsersRolesMemberRow = {
  member_id: string;
  user_id: string;
  profile: {
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    display_name: string;
    email: string | null;
  };
  role: { code: string; label: string };
  membership: {
    status: { code: string; label: string };
    /** YYYY-MM-DD (organization timezone). */
    start_date: string | null;
  };
  client_access: ClientAccessProjection;
  module_access: ModuleAccessProjection;
  /** Present only when close_access is available: what must be reassigned first. */
  close_access: { blockers: CloseAccessBlockers; blocked: boolean } | null;
  is_self: boolean;
  available_actions: MemberActions;
};

export type UsersRolesInvitationRow = {
  invitation_id: string;
  email: string;
  role: { code: string; label: string };
  status: { code: string; label: string };
  send_count: number;
  last_sent_date: string | null;
  available_actions: { resend: boolean; cancel: boolean };
};

export type UsersRolesAggregate = {
  aggregate_key: 'users_roles_aggregate';
  organization_id: string;
  available_actions: { invite_member: boolean };
  /** Roles an invitation may carry. Backend-owned; the form renders exactly these. */
  invite_roles: Array<{ code: string; label: string }>;
  members: UsersRolesMemberRow[];
  invitations: UsersRolesInvitationRow[];
};

function assertOfficeActor(ctx: RequestContext, orgId: string): void {
  if (ctx.organizationId !== orgId || !ctx.membership) throw forbidden('Organization context required');
  if (!roleHasOfficeClientAccess(ctx.membership.roleCode)) {
    throw forbidden('Only Owner or Admin may manage members');
  }
}

function actorFlags(ctx: RequestContext): { canWrite: boolean; canRevoke: boolean } {
  const permissions = ctx.membership?.permissions ?? [];
  return {
    canWrite: permissions.includes('members:write'),
    canRevoke: permissions.includes('members:revoke'),
  };
}

type MembershipRecord = {
  id: string;
  user_id: string;
  role_code: string;
  status: string;
  joined_at: string | null;
  users?: { email: string | null; full_name: string | null } | { email: string | null; full_name: string | null }[] | null;
};

export async function buildUsersRolesAggregate(ctx: RequestContext, orgId: string): Promise<UsersRolesAggregate> {
  assertOfficeActor(ctx, orgId);
  requireRbacPermission(ctx, orgId, RBAC_PERMISSIONS.view_users);
  const { canWrite, canRevoke } = actorFlags(ctx);
  const actorRole = ctx.membership?.roleCode ?? '';

  const [orgRes, membershipsRes, profilesRes, assignableModules] = await Promise.all([
    supabaseAdmin.from('organizations').select('timezone').eq('id', orgId).maybeSingle(),
    supabaseAdmin
      .from('organization_memberships')
      .select('id, user_id, role_code, status, joined_at, users(email, full_name)')
      .eq('organization_id', orgId)
      .in('status', ['active', 'invited', 'revoked']),
    supabaseAdmin
      .from('organization_member_profiles')
      .select('membership_id, first_name, last_name, phone')
      .eq('organization_id', orgId),
    loadOrganizationAssignableModuleNames(orgId),
  ]);
  if (membershipsRes.error) throw membershipsRes.error;
  if (profilesRes.error) throw profilesRes.error;
  const timeZone = (orgRes.data as { timezone?: string | null } | null)?.timezone ?? 'UTC';

  const profileByMembership = new Map(
    (profilesRes.data ?? []).map((row) => [
      String((row as { membership_id: string }).membership_id),
      row as { first_name: string | null; last_name: string | null; phone: string | null },
    ]),
  );

  const memberships = (membershipsRes.data ?? []) as unknown as MembershipRecord[];

  const rows = await Promise.all(
    memberships.map(async (m): Promise<UsersRolesMemberRow> => {
      const user = supabaseEmbedOne(m.users);
      const profile = profileByMembership.get(m.id);
      const isEmployee = m.role_code === 'staff' || m.role_code === 'viewer';
      const isActive = m.status === 'active';
      const actions = computeMemberActions({
        actorRoleCode: actorRole,
        actorCanWriteMembers: canWrite,
        actorCanRevokeAccess: canRevoke,
        actorUserId: ctx.user.id,
        targetRoleCode: m.role_code,
        targetStatus: m.status,
        targetUserId: m.user_id,
      });

      // Client access: the same resolver that enforces visibility. Closed members show nothing to manage.
      let clientAccess: ClientAccessProjection;
      let moduleAccess: ModuleAccessProjection;
      if (isEmployee && isActive) {
        const scope = await resolveOrganizationClientAccessScope({
          organizationId: orgId,
          viewerUserId: m.user_id,
          roleCode: m.role_code,
        });
        clientAccess =
          scope.authorized_client_ids === null
            ? buildClientAccessProjection({ applicable: true, policyMode: 'all', activeGrantCount: 0 })
            : buildClientAccessProjection({
                applicable: true,
                policyMode: 'selected',
                activeGrantCount: scope.authorized_client_ids.length,
              });
        const effective = await loadEnabledMemberModuleIdSet(orgId, m.user_id);
        moduleAccess = buildModuleAccessProjection({
          applicable: true,
          enabledModules: [...assignableModules.entries()]
            .filter(([id]) => effective.has(id))
            .map(([module_id, name]) => ({ module_id, name })),
        });
      } else if (isEmployee) {
        clientAccess = { applicable: false, mode: 'selected', selected_count: 0, summary: 'No access' };
        moduleAccess = { applicable: false, enabled_modules: [], summary: 'No access' };
      } else {
        clientAccess = buildClientAccessProjection({ applicable: false, policyMode: 'all', activeGrantCount: 0 });
        moduleAccess = buildModuleAccessProjection({ applicable: false, enabledModules: [] });
      }

      let closeAccess: UsersRolesMemberRow['close_access'] = null;
      if (actions.close_access) {
        const blockers = await loadCloseAccessBlockers(orgId, m.user_id);
        closeAccess = { blockers, blocked: hasCloseAccessBlockers(blockers) };
      }

      return {
        member_id: m.id,
        user_id: m.user_id,
        profile: {
          first_name: profile?.first_name ?? null,
          last_name: profile?.last_name ?? null,
          phone: profile?.phone ?? null,
          display_name: resolveMemberDisplayName({
            firstName: profile?.first_name,
            lastName: profile?.last_name,
            fullName: user?.full_name,
            email: user?.email,
          }),
          email: user?.email ?? null,
        },
        role: { code: m.role_code, label: resolveRoleLabel(m.role_code) },
        membership: {
          status: resolveMemberStatus(m.status),
          start_date: toDateOnly(m.joined_at, timeZone),
        },
        client_access: clientAccess,
        module_access: moduleAccess,
        close_access: closeAccess,
        is_self: m.user_id === ctx.user.id,
        available_actions: actions,
      };
    }),
  );

  rows.sort((a, b) => {
    const statusRank = (r: UsersRolesMemberRow) => (r.membership.status.code === 'active' ? 0 : 1);
    return (
      statusRank(a) - statusRank(b) ||
      (ROLE_RANK[a.role.code] ?? 9) - (ROLE_RANK[b.role.code] ?? 9) ||
      a.profile.display_name.localeCompare(b.profile.display_name)
    );
  });

  // Pending invitations stay a separate list: an invitation is not a member.
  const invites = await listInvitesRbac(ctx, orgId);
  const invitations: UsersRolesInvitationRow[] = invites.map((inv) => ({
    invitation_id: inv.id,
    email: inv.email,
    role: { code: inv.role_key, label: resolveRoleLabel(inv.role_key) },
    status: resolveInvitationStatus(inv.status),
    send_count: inv.send_count,
    last_sent_date: toDateOnly(inv.last_sent_at ?? inv.created_at, timeZone),
    available_actions: { resend: canWrite, cancel: canWrite },
  }));

  return {
    aggregate_key: 'users_roles_aggregate',
    organization_id: orgId,
    available_actions: { invite_member: canWrite },
    invite_roles: canWrite
      ? ['admin', 'staff', 'viewer'].map((code) => ({ code, label: resolveRoleLabel(code) }))
      : [],
    members: rows,
    invitations,
  };
}

async function loadTargetMembership(orgId: string, membershipId: string) {
  const targetId = String(membershipId ?? '').trim().toLowerCase();
  if (!UUID_RE.test(targetId)) throw forbidden('Member not found');
  // Scoped by organization: a membership id from another organization never resolves.
  const { data, error } = await supabaseAdmin
    .from('organization_memberships')
    .select('id, user_id, role_code, status')
    .eq('organization_id', orgId)
    .eq('id', targetId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw forbidden('Member not found');
  return data as { id: string; user_id: string; role_code: string; status: string };
}

function maskPhone(phone: string | null | undefined): string | null {
  const p = String(phone ?? '');
  if (!p) return null;
  return `***${p.replace(/\D/g, '').slice(-3)}`;
}

/** Named command: Owner/Admin sets the organization-specific profile of a member. */
export async function setMemberProfile(
  ctx: RequestContext,
  orgId: string,
  membershipId: string,
  body: unknown,
): Promise<UsersRolesAggregate> {
  assertOfficeActor(ctx, orgId);
  if (!actorFlags(ctx).canWrite) throw forbidden('Insufficient permission');

  const input = normalizeMemberProfileInput(body);
  if (!input.ok) throw badRequest(input.message, input.code);

  const target = await loadTargetMembership(orgId, membershipId);
  if (target.status !== 'active') {
    throw badRequest('Profile can be edited for active members only', 'MEMBER_PROFILE_TARGET_INACTIVE');
  }
  if (target.role_code === 'owner' && ctx.membership?.roleCode !== 'owner') {
    throw forbidden('Only the Owner may edit the Owner profile');
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('organization_member_profiles')
    .select('first_name, last_name, phone')
    .eq('organization_id', orgId)
    .eq('membership_id', target.id)
    .maybeSingle();
  if (existingError) throw existingError;
  const before = {
    first_name: (existing as { first_name: string | null } | null)?.first_name ?? null,
    last_name: (existing as { last_name: string | null } | null)?.last_name ?? null,
    phone: (existing as { phone: string | null } | null)?.phone ?? null,
  };
  const after = {
    first_name: input.patch.first_name === undefined ? before.first_name : input.patch.first_name,
    last_name: input.patch.last_name === undefined ? before.last_name : input.patch.last_name,
    phone: input.patch.phone === undefined ? before.phone : input.patch.phone,
  };
  const changed = (Object.keys(after) as Array<keyof typeof after>).filter((k) => after[k] !== before[k]);

  if (changed.length > 0) {
    const { error } = await supabaseAdmin.from('organization_member_profiles').upsert(
      {
        membership_id: target.id,
        organization_id: orgId,
        ...after,
        updated_by_user_id: ctx.user.id,
      },
      { onConflict: 'membership_id' },
    );
    if (error) {
      throw new AppError(500, 'Failed to save member profile', 'MEMBER_PROFILE_SAVE_FAILED');
    }
    await writeAudit({
      organizationId: orgId,
      actorUserId: ctx.user.id,
      entityType: 'organization_member_profile',
      entityId: target.id,
      action: AUDIT_ACTIONS.MEMBER_PROFILE_SET,
      payload: {
        target_membership_id: target.id,
        target_user_id: target.user_id,
        changed_fields: changed,
        before: { first_name: before.first_name, last_name: before.last_name, phone: maskPhone(before.phone) },
        after: { first_name: after.first_name, last_name: after.last_name, phone: maskPhone(after.phone) },
      },
    });
  }

  return buildUsersRolesAggregate(ctx, orgId);
}

/** Named command: Owner closes a member's access, then returns the refreshed aggregate. */
export async function closeMemberAccess(
  ctx: RequestContext,
  orgId: string,
  membershipId: string,
): Promise<UsersRolesAggregate> {
  assertOfficeActor(ctx, orgId);
  const target = await loadTargetMembership(orgId, membershipId);
  await revokeUserAccessRbac(ctx, orgId, target.id);
  return buildUsersRolesAggregate(ctx, orgId);
}

export type MemberClientAccessEditorAggregate = {
  aggregate_key: 'member_client_access_editor';
  organization_id: string;
  member: { member_id: string; display_name: string; role_label: string };
  access_mode: 'all' | 'selected';
  selected_client_ids: string[];
  selected_client_count: number;
  clients: Array<{ client_id: string; display_name: string; tax_id: string | null }>;
  catalog_truncated: boolean;
};

const CLIENT_CATALOG_PAGE = 1000;
const CLIENT_CATALOG_MAX = 5000;

/** One screen, one aggregate: the focused "Manage clients" editor. */
export async function buildMemberClientAccessEditorAggregate(
  ctx: RequestContext,
  orgId: string,
  membershipId: string,
): Promise<MemberClientAccessEditorAggregate> {
  assertOfficeActor(ctx, orgId);
  requireRbacPermission(ctx, orgId, RBAC_PERMISSIONS.view_users);
  const target = await loadTargetMembership(orgId, membershipId);
  if (target.status !== 'active' || !['staff', 'viewer'].includes(target.role_code)) {
    throw badRequest('Client access applies to active employees only', 'MEMBER_CLIENT_ACCESS_TARGET_ROLE');
  }

  const scope = await resolveOrganizationClientAccessScope({
    organizationId: orgId,
    viewerUserId: target.user_id,
    roleCode: target.role_code,
  });

  const clients: MemberClientAccessEditorAggregate['clients'] = [];
  let truncated = false;
  for (let from = 0; from < CLIENT_CATALOG_MAX; from += CLIENT_CATALOG_PAGE) {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('id, display_name, tax_id')
      .eq('organization_id', orgId)
      .eq('is_archived', false)
      .order('display_name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + CLIENT_CATALOG_PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as Array<{ id: string; display_name: string; tax_id: string | null }>;
    clients.push(...page.map((c) => ({ client_id: c.id, display_name: c.display_name, tax_id: c.tax_id ?? null })));
    if (page.length < CLIENT_CATALOG_PAGE) break;
    if (from + CLIENT_CATALOG_PAGE >= CLIENT_CATALOG_MAX) truncated = true;
  }

  const selected = scope.authorized_client_ids ?? [];
  const { data: profile } = await supabaseAdmin
    .from('organization_member_profiles')
    .select('first_name, last_name')
    .eq('organization_id', orgId)
    .eq('membership_id', target.id)
    .maybeSingle();
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('email, full_name')
    .eq('id', target.user_id)
    .maybeSingle();

  return {
    aggregate_key: 'member_client_access_editor',
    organization_id: orgId,
    member: {
      member_id: target.id,
      display_name: resolveMemberDisplayName({
        firstName: (profile as { first_name?: string | null } | null)?.first_name,
        lastName: (profile as { last_name?: string | null } | null)?.last_name,
        fullName: (user as { full_name?: string | null } | null)?.full_name,
        email: (user as { email?: string | null } | null)?.email,
      }),
      role_label: resolveRoleLabel(target.role_code),
    },
    access_mode: scope.authorized_client_ids === null ? 'all' : 'selected',
    selected_client_ids: selected,
    selected_client_count: selected.length,
    clients,
    catalog_truncated: truncated,
  };
}
