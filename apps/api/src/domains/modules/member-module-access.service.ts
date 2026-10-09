/**
 * Stage 5.4 — Staff/Viewer member module grants.
 * Owner/Admin skip the grant. A grant never activates an organization module.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import { roleHasOfficeClientAccess } from '../client-operations/organization-client-access.pure.js';
import { resolveMemberDisplayName } from '../memberships/users-roles.pure.js';
import { filterSessionEnabledModuleCodes, resolveEntitlement } from './entitlement.service.js';
import { resolveModuleEntitlementCode } from '../../shared/module-entitlement.pure.js';
import {
  classifyModule,
  deriveEffectiveMemberModuleIds,
  findNonAssignableModuleIds,
  projectModuleAssignability,
  type ModuleAssignabilityProjection,
  type ModuleCatalogRow,
} from './member-module-assignability.pure.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MemberModuleAccessItem = {
  module_id: string;
  code: string;
};

export type MemberModuleAccessAggregate = {
  aggregate_key: 'member_module_access';
  organization_id: string;
  membership_id: string;
  user_id: string;
  role_code: string;
  status: string;
  enabled_module_ids: string[];
  enabled_modules: MemberModuleAccessItem[];
};

function mapRpcError(message: string): AppError {
  if (message.includes('MEMBER_MODULE_ACCESS_FORBIDDEN')) {
    return forbidden('Only Owner or Admin may set module access', 'MEMBER_MODULE_ACCESS_FORBIDDEN');
  }
  if (message.includes('MEMBER_MODULE_ACCESS_CROSS_ORG_MEMBER')) {
    return forbidden('Member not found', 'MEMBER_MODULE_ACCESS_FORBIDDEN');
  }
  if (message.includes('MEMBER_MODULE_ACCESS_TARGET_INACTIVE')) {
    return badRequest('Target membership is not active', 'MEMBER_MODULE_ACCESS_TARGET_INACTIVE');
  }
  if (message.includes('MEMBER_MODULE_ACCESS_TARGET_ROLE')) {
    return forbidden('Module access applies to Staff and Viewer only', 'MEMBER_MODULE_ACCESS_TARGET_ROLE');
  }
  if (message.includes('MEMBER_MODULE_ACCESS_UNKNOWN_MODULE')) {
    return badRequest('Unknown module', 'MEMBER_MODULE_ACCESS_UNKNOWN_MODULE');
  }
  if (message.includes('MEMBER_MODULE_ACCESS_UNENTITLED')) {
    return forbidden('Organization is not entitled to this module', 'MEMBER_MODULE_ACCESS_UNENTITLED');
  }
  if (message.includes('MEMBER_MODULE_ACCESS_TOO_MANY')) {
    return badRequest('Too many modules', 'MEMBER_MODULE_ACCESS_TOO_MANY');
  }
  return new AppError(500, message || 'Failed to set module access', 'MEMBER_MODULE_ACCESS_FAILED');
}

export function normalizeMemberModuleAccessInput(body: unknown): string[] {
  const raw = (body ?? {}) as { enabled_modules?: unknown };
  if (!Array.isArray(raw.enabled_modules)) {
    throw badRequest('enabled_modules is required', 'MEMBER_MODULE_ACCESS_REQUIRED');
  }
  const values = raw.enabled_modules.map((item) => String(item ?? '').trim()).filter(Boolean);
  if (values.length > 100) throw badRequest('Too many modules', 'MEMBER_MODULE_ACCESS_TOO_MANY');
  return [...new Set(values)];
}

async function resolveCanonicalModuleIds(tokens: string[]): Promise<string[]> {
  const ids: string[] = [];
  const codes: string[] = [];
  for (const token of tokens) {
    if (UUID_RE.test(token)) ids.push(token.toLowerCase());
    else codes.push(token);
  }
  if (codes.length > 0) {
    const { data, error } = await supabaseAdmin.from('modules').select('id, code').in('code', codes);
    if (error) throw error;
    const byCode = new Map((data ?? []).map((row) => [String(row.code), String(row.id)]));
    for (const code of codes) {
      const id = byCode.get(code);
      if (!id) throw badRequest('Unknown module', 'MEMBER_MODULE_ACCESS_UNKNOWN_MODULE');
      ids.push(id);
    }
  }
  if (ids.length > 0) {
    const { data, error } = await supabaseAdmin.from('modules').select('id').in('id', ids);
    if (error) throw error;
    const found = new Set((data ?? []).map((row) => String(row.id)));
    for (const id of ids) {
      if (!found.has(id)) throw badRequest('Unknown module', 'MEMBER_MODULE_ACCESS_UNKNOWN_MODULE');
    }
  }
  return [...new Set(ids)];
}

export async function setMemberModuleAccess(
  ctx: RequestContext,
  orgId: string,
  membershipId: string,
  body: unknown,
): Promise<MemberModuleAccessAggregate> {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
  if (!roleHasOfficeClientAccess(ctx.membership?.roleCode)) {
    throw forbidden('Only Owner or Admin may set module access', 'MEMBER_MODULE_ACCESS_FORBIDDEN');
  }
  const targetId = String(membershipId ?? '').trim().toLowerCase();
  if (!UUID_RE.test(targetId)) throw forbidden('Member not found');
  const moduleIds = await resolveCanonicalModuleIds(normalizeMemberModuleAccessInput(body));
  // Stage 5.5: only user-facing, active catalog modules are assignable. Infrastructure
  // modules (Work Engine) are never member grants; they follow their host module.
  const nonAssignable = findNonAssignableModuleIds(await loadModuleCatalog(), moduleIds);
  if (nonAssignable.length > 0) {
    throw badRequest('Module is not assignable to members', 'MEMBER_MODULE_ACCESS_NOT_ASSIGNABLE');
  }

  const { data, error } = await supabaseAdmin.rpc('set_organization_member_module_access', {
    p_organization_id: orgId,
    p_actor_user_id: ctx.user.id,
    p_membership_id: targetId,
    p_module_ids: moduleIds,
  });
  if (error) throw mapRpcError(String(error.message ?? ''));
  const row = (data ?? {}) as MemberModuleAccessAggregate;
  const enabledModules = Array.isArray(row.enabled_modules)
    ? row.enabled_modules.map((item) => ({
        module_id: String(item.module_id ?? ''),
        code: String(item.code ?? ''),
      }))
    : [];
  return {
    aggregate_key: 'member_module_access',
    organization_id: String(row.organization_id ?? orgId),
    membership_id: String(row.membership_id ?? targetId),
    user_id: String(row.user_id ?? ''),
    role_code: String(row.role_code ?? ''),
    status: String(row.status ?? ''),
    enabled_module_ids: Array.isArray(row.enabled_module_ids) ? row.enabled_module_ids.map(String) : [],
    enabled_modules: enabledModules,
  };
}

async function loadModuleCatalog(): Promise<ModuleCatalogRow[]> {
  const { data, error } = await supabaseAdmin
    .from('modules')
    .select('id, code, name, is_active, is_system, nav_path');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: String(row.id),
    code: String(row.code),
    name: (row.name as string | null) ?? null,
    is_active: Boolean(row.is_active),
    is_system: Boolean(row.is_system),
    nav_path: (row.nav_path as string | null) ?? null,
  }));
}

export type MemberModuleAssignabilityAggregate = {
  aggregate_key: 'member_module_assignability';
  organization_id: string;
  membership_id: string;
  role_code: string;
  /** Presentation only: structured name, else users.full_name, else email. */
  member_display_name: string;
  /** false for Owner/Admin and inactive members: module grants do not apply. */
  applicable: boolean;
  modules: ModuleAssignabilityProjection[];
};

/**
 * Backend truth for the Users & Roles module picker. The UI renders `modules` as-is and
 * shows a checkbox only where `member_assignable` is true.
 */
export async function buildMemberModuleAssignabilityAggregate(
  ctx: RequestContext,
  orgId: string,
  membershipId: string,
): Promise<MemberModuleAssignabilityAggregate> {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
  if (!roleHasOfficeClientAccess(ctx.membership?.roleCode)) {
    throw forbidden('Only Owner or Admin may read module access', 'MEMBER_MODULE_ACCESS_FORBIDDEN');
  }
  const targetId = String(membershipId ?? '').trim().toLowerCase();
  if (!UUID_RE.test(targetId)) throw forbidden('Member not found');

  const { data: target, error: targetError } = await supabaseAdmin
    .from('organization_memberships')
    .select('id, user_id, role_code, status, users(email, full_name)')
    .eq('organization_id', orgId)
    .eq('id', targetId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw forbidden('Member not found');
  const { data: profile } = await supabaseAdmin
    .from('organization_member_profiles')
    .select('first_name, last_name')
    .eq('organization_id', orgId)
    .eq('membership_id', targetId)
    .maybeSingle();
  const userEmbed = (Array.isArray(target.users) ? target.users[0] : target.users) as
    | { email?: string | null; full_name?: string | null }
    | null
    | undefined;
  const memberDisplayName = resolveMemberDisplayName({
    firstName: (profile as { first_name?: string | null } | null)?.first_name,
    lastName: (profile as { last_name?: string | null } | null)?.last_name,
    fullName: userEmbed?.full_name,
    email: userEmbed?.email,
  });

  const catalog = (await loadModuleCatalog()).filter((row) => row.is_active);
  const { data: orgModules, error: orgModulesError } = await supabaseAdmin
    .from('organization_modules')
    .select('module_id')
    .eq('organization_id', orgId)
    .eq('status', 'active');
  if (orgModulesError) throw orgModulesError;
  const activeIds = new Set((orgModules ?? []).map((row) => String(row.module_id)));
  const entitledCodes = await filterSessionEnabledModuleCodes({
    organizationId: orgId,
    modules: catalog.filter((row) => activeIds.has(row.id)).map((row) => ({ moduleId: row.id, code: row.code })),
  });

  const memberStaffOrViewer = target.status === 'active' && ['staff', 'viewer'].includes(String(target.role_code));
  const effective = memberStaffOrViewer
    ? await loadEnabledMemberModuleIdSet(orgId, String(target.user_id))
    : new Set<string>();

  return {
    aggregate_key: 'member_module_assignability',
    organization_id: orgId,
    membership_id: targetId,
    role_code: String(target.role_code),
    member_display_name: memberDisplayName,
    applicable: memberStaffOrViewer,
    modules: catalog.map((row) =>
      projectModuleAssignability({
        row,
        organizationEntitled: activeIds.has(row.id) && entitledCodes.has(row.code),
        memberEnabled: effective.has(row.id),
      }),
    ),
  };
}

/**
 * Employee-assignable modules of the organization (active, user-facing, entitled) with display
 * names. Used by the Users & Roles aggregate to summarise a member's enabled modules.
 */
export async function loadOrganizationAssignableModuleNames(orgId: string): Promise<Map<string, string>> {
  const catalog = (await loadModuleCatalog()).filter((row) => row.is_active && classifyModule(row) === 'user_facing');
  const { data: orgModules, error } = await supabaseAdmin
    .from('organization_modules')
    .select('module_id')
    .eq('organization_id', orgId)
    .eq('status', 'active');
  if (error) throw error;
  const activeIds = new Set((orgModules ?? []).map((row) => String(row.module_id)));
  const candidates = catalog.filter((row) => activeIds.has(row.id));
  const entitledCodes = await filterSessionEnabledModuleCodes({
    organizationId: orgId,
    modules: candidates.map((row) => ({ moduleId: row.id, code: row.code })),
  });
  const out = new Map<string, string>();
  for (const row of candidates) {
    if (entitledCodes.has(row.code)) out.set(row.id, String(row.name ?? '').trim() || row.code);
  }
  return out;
}

/**
 * Effective module ids of an active Staff/Viewer: explicit grants on user-facing modules plus
 * infrastructure modules reached through a granted host module (Stage 5.5 canonical rule).
 * Session, modules-state and requireModuleActive all read this one function.
 */
export async function loadEnabledMemberModuleIdSet(organizationId: string, userId: string): Promise<Set<string>> {
  const granted = await loadExplicitMemberModuleGrantIdSet(organizationId, userId);
  if (granted.size === 0) return new Set();
  return deriveEffectiveMemberModuleIds(await loadModuleCatalog(), granted);
}

/** Explicit `organization_member_module_access` grants. Missing membership → empty. */
async function loadExplicitMemberModuleGrantIdSet(organizationId: string, userId: string): Promise<Set<string>> {
  const { data: membership, error: membershipError } = await supabaseAdmin
    .from('organization_memberships')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .in('role_code', ['staff', 'viewer'])
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership?.id) return new Set();

  const { data, error } = await supabaseAdmin
    .from('organization_member_module_access')
    .select('module_id')
    .eq('organization_id', organizationId)
    .eq('membership_id', membership.id)
    .eq('enabled', true);
  if (error) throw error;
  return new Set((data ?? []).map((row) => String(row.module_id)));
}

/**
 * Staff/Viewer require an enabled grant on this module id.
 * Owner/Admin return without a row. Revoked membership has no active row, so deny.
 */
export async function assertStaffViewerMayUseModule(ctx: RequestContext, moduleId: string): Promise<void> {
  if (roleHasOfficeClientAccess(ctx.membership?.roleCode)) return;
  if (!ctx.organizationId || !ctx.user?.id) throw forbidden('Organization context required');

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from('organization_memberships')
    .select('id, status')
    .eq('organization_id', ctx.organizationId)
    .eq('user_id', ctx.user.id)
    .eq('status', 'active')
    .in('role_code', ['staff', 'viewer'])
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership?.id) {
    throw forbidden('Membership is not active', 'MEMBERSHIP_INACTIVE');
  }

  const { data: grant, error: grantError } = await supabaseAdmin
    .from('organization_member_module_access')
    .select('module_id')
    .eq('organization_id', ctx.organizationId)
    .eq('membership_id', membership.id)
    .eq('enabled', true);
  if (grantError) throw grantError;
  const granted = new Set((grant ?? []).map((row) => String(row.module_id)));
  // Direct grant on a user-facing module, or infrastructure reached through a granted host.
  const effective = deriveEffectiveMemberModuleIds(await loadModuleCatalog(), granted);
  if (!effective.has(moduleId)) {
    throw forbidden('Module access is not granted', 'MEMBER_MODULE_ACCESS_DENIED');
  }
}

/** Staff/Viewer DocFlow paths that skip requireModuleActive still require entitlement and a grant. */
export async function assertStaffViewerMayUseEntitledModuleCode(
  ctx: RequestContext,
  moduleCode: string,
): Promise<void> {
  if (roleHasOfficeClientAccess(ctx.membership?.roleCode)) return;
  if (!ctx.organizationId) throw forbidden('Organization context required');
  const entitlementCode = resolveModuleEntitlementCode(moduleCode);
  const { data: mod, error } = await supabaseAdmin
    .from('modules')
    .select('id, is_active')
    .eq('code', entitlementCode)
    .maybeSingle();
  if (error) throw error;
  if (!mod?.id || mod.is_active === false) throw forbidden('Module not active for this organization');
  const entitlement = await resolveEntitlement(ctx.organizationId, String(mod.id));
  if (entitlement.status !== 'entitled' && entitlement.status !== 'trial') {
    throw forbidden(entitlement.reason ?? 'Not entitled to use this module');
  }
  await assertStaffViewerMayUseModule(ctx, String(mod.id));
}
