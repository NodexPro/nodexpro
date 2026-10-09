/**
 * Canonical organization client access scope.
 *
 * Visibility is organization_member_client_access / grants.
 * Responsibility remains client_operational_profiles.assigned_handler_user_id
 * and is not an authorization input.
 *
 * - OFFICE — Owner/Admin, all org clients
 * - MEMBER_ALL — Staff/Viewer policy all (current and future; archived excluded by readers)
 * - ASSIGNED_TO_SELF — Staff/Viewer selected grants, or fail closed to assigned-only empty set
 */

import { supabaseAdmin } from '../../db/client.js';
import { forbidden } from '../../shared/errors.js';
import type { RequestContext } from '../../shared/context.js';
import {
  backfillStaffViewerClientAccess,
  buildClientAccessScopeKey,
  canManageClientHandlerAssignment,
  canManageMemberClientAccess,
  clientIdIsAuthorized,
  filterAuthorizedClientIds,
  normalizeMemberClientAccessCommand,
  roleHasOfficeClientAccess,
  scopeForMemberClientPolicy,
  type MemberClientAccessMode,
  type OrganizationClientAccessScope,
  type OrganizationClientAccessScopeKind,
} from './organization-client-access.pure.js';

export type { MemberClientAccessMode, OrganizationClientAccessScope, OrganizationClientAccessScopeKind };
export {
  backfillStaffViewerClientAccess,
  buildClientAccessScopeKey,
  canManageClientHandlerAssignment,
  canManageMemberClientAccess,
  clientIdIsAuthorized,
  filterAuthorizedClientIds,
  normalizeMemberClientAccessCommand,
  roleHasOfficeClientAccess,
  scopeForMemberClientPolicy,
};

export async function loadAssignedClientIdsForHandler(
  organizationId: string,
  handlerUserId: string,
): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('client_operational_profiles')
    .select('client_id')
    .eq('organization_id', organizationId)
    .eq('assigned_handler_user_id', handlerUserId);
  if (error) throw new Error(error.message ?? 'Failed to load assigned clients');
  return (data ?? [])
    .map((r) => String((r as { client_id: string }).client_id ?? ''))
    .filter(Boolean);
}

/**
 * Resolve backend-owned client access scope for the authenticated membership.
 * Frontend-supplied scope is ignored — only organizationId + viewer + role matter.
 */
export async function resolveOrganizationClientAccessScope(params: {
  organizationId: string;
  viewerUserId: string;
  roleCode: string | null | undefined;
}): Promise<OrganizationClientAccessScope> {
  const organization_id = String(params.organizationId ?? '').trim();
  const viewer_user_id = String(params.viewerUserId ?? '').trim();
  const role_code = String(params.roleCode ?? '').trim().toLowerCase();
  if (!organization_id || !viewer_user_id) {
    throw forbidden('Organization and viewer required for client access');
  }

  if (roleHasOfficeClientAccess(role_code)) {
    return {
      organization_id,
      viewer_user_id,
      role_code,
      kind: 'OFFICE',
      access_scope_key: buildClientAccessScopeKey({ kind: 'OFFICE', viewerUserId: viewer_user_id }),
      authorized_client_ids: null,
    };
  }

  // Staff/Viewer/unknown: policy table only. Missing policy is fail closed to assigned-only.
  // Do not fall back to assigned_handler_user_id.
  const { data: policy, error: policyError } = await supabaseAdmin
    .from('organization_member_client_access')
    .select('access_mode')
    .eq('organization_id', organization_id)
    .eq('user_id', viewer_user_id)
    .maybeSingle();
  if (policyError) throw new Error(policyError.message ?? 'Failed to load client access policy');

  const accessMode = String((policy as { access_mode?: string } | null)?.access_mode ?? '').trim().toLowerCase();
  let grantedActiveClientIds: string[] = [];
  if (accessMode === 'selected') {
    const { data: grants, error: grantError } = await supabaseAdmin
      .from('organization_member_client_grants')
      .select('client_id')
      .eq('organization_id', organization_id)
      .eq('user_id', viewer_user_id);
    if (grantError) throw new Error(grantError.message ?? 'Failed to load client access grants');
    const grantIds = (grants ?? [])
      .map((row) => String((row as { client_id: string }).client_id ?? '').trim())
      .filter(Boolean);
    if (grantIds.length > 0) {
      const { data: liveClients, error: clientError } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('organization_id', organization_id)
        .eq('is_archived', false)
        .in('id', grantIds);
      if (clientError) throw new Error(clientError.message ?? 'Failed to load granted clients');
      grantedActiveClientIds = (liveClients ?? []).map((row) => String((row as { id: string }).id));
    }
  }

  return scopeForMemberClientPolicy({
    organizationId: organization_id,
    viewerUserId: viewer_user_id,
    roleCode: role_code,
    accessMode,
    grantedActiveClientIds,
  });
}

/** Null means unrestricted (Owner/Admin or Staff/Viewer ALL). An array is the allow-list. */
export async function authorizedClientIdsForViewer(params: {
  organizationId: string;
  userId: string;
  roleCode: string | null | undefined;
}): Promise<string[] | null> {
  if (roleHasOfficeClientAccess(params.roleCode)) return null;
  const scope = await resolveOrganizationClientAccessScope({
    organizationId: params.organizationId,
    viewerUserId: params.userId,
    roleCode: params.roleCode,
  });
  return scope.authorized_client_ids;
}

export async function resolveOrganizationClientAccessScopeFromContext(
  ctx: RequestContext,
): Promise<OrganizationClientAccessScope> {
  const organizationId = ctx.organizationId;
  if (!organizationId) throw forbidden('Organization context required');
  return resolveOrganizationClientAccessScope({
    organizationId,
    viewerUserId: ctx.user.id,
    roleCode: ctx.membership?.roleCode ?? null,
  });
}

export async function assertCanAccessClient(params: {
  organizationId: string;
  viewerUserId: string;
  roleCode: string | null | undefined;
  clientId: string;
  /** Optional pre-resolved scope to avoid duplicate DB reads. */
  scope?: OrganizationClientAccessScope;
}): Promise<OrganizationClientAccessScope> {
  const clientId = String(params.clientId ?? '').trim();
  if (!clientId) throw forbidden('Client not found');

  const scope =
    params.scope ??
    (await resolveOrganizationClientAccessScope({
      organizationId: params.organizationId,
      viewerUserId: params.viewerUserId,
      roleCode: params.roleCode,
    }));

  const { data } = await supabaseAdmin
    .from('clients')
    .select('id, is_archived')
    .eq('organization_id', params.organizationId)
    .eq('id', clientId)
    .maybeSingle();
  const row = data as { id: string; is_archived?: boolean } | null;

  if (scope.kind === 'OFFICE') {
    if (!row) throw forbidden('Client not found');
    return scope;
  }

  // Staff/Viewer: do not leak existence, and never expose an archived client.
  if (!row || row.is_archived === true || !clientIdIsAuthorized(scope, clientId)) {
    throw forbidden('Client not found');
  }
  return scope;
}

export async function assertCanAccessClientFromContext(
  ctx: RequestContext,
  clientId: string,
  scope?: OrganizationClientAccessScope,
): Promise<OrganizationClientAccessScope> {
  const organizationId = ctx.organizationId;
  if (!organizationId) throw forbidden('Organization context required');
  return assertCanAccessClient({
    organizationId,
    viewerUserId: ctx.user.id,
    roleCode: ctx.membership?.roleCode ?? null,
    clientId,
    scope,
  });
}
