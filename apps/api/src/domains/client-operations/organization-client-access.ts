/**
 * Canonical organization client access scope (Stage 3).
 *
 * Responsibility field remains client_operational_profiles.assigned_handler_user_id.
 * This module converts that into BACKEND access scope — not frontend filtering.
 *
 * Scope kinds (Stage 4-ready):
 * - OFFICE — Owner/Admin see all org clients (including unassigned)
 * - ASSIGNED_TO_SELF — Staff/Viewer see only clients assigned to them
 */

import { supabaseAdmin } from '../../db/client.js';
import { forbidden } from '../../shared/errors.js';
import type { RequestContext } from '../../shared/context.js';
import {
  buildClientAccessScopeKey,
  canManageClientHandlerAssignment,
  clientIdIsAuthorized,
  filterAuthorizedClientIds,
  roleHasOfficeClientAccess,
  type OrganizationClientAccessScope,
  type OrganizationClientAccessScopeKind,
} from './organization-client-access.pure.js';

export type { OrganizationClientAccessScope, OrganizationClientAccessScopeKind };
export {
  buildClientAccessScopeKey,
  canManageClientHandlerAssignment,
  clientIdIsAuthorized,
  filterAuthorizedClientIds,
  roleHasOfficeClientAccess,
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

  // Staff + Viewer (+ unknown): fail closed to assigned-only.
  // Viewer has view permissions but must NOT see the full office client set.
  const assigned = await loadAssignedClientIdsForHandler(organization_id, viewer_user_id);
  return {
    organization_id,
    viewer_user_id,
    role_code,
    kind: 'ASSIGNED_TO_SELF',
    access_scope_key: buildClientAccessScopeKey({
      kind: 'ASSIGNED_TO_SELF',
      viewerUserId: viewer_user_id,
    }),
    authorized_client_ids: assigned,
  };
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

  if (scope.kind === 'OFFICE') {
    // Still verify client belongs to org (tenant isolation).
    const { data } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('organization_id', params.organizationId)
      .eq('id', clientId)
      .maybeSingle();
    if (!data) throw forbidden('Client not found');
    return scope;
  }

  if (!clientIdIsAuthorized(scope, clientId)) {
    // Do not leak existence of unauthorized clients.
    throw forbidden('Client not found');
  }

  const { data } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organization_id', params.organizationId)
    .eq('id', clientId)
    .maybeSingle();
  if (!data) throw forbidden('Client not found');
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
