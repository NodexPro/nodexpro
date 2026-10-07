/**
 * Pure helpers for organization client access scope (Stage 3).
 * No DB / env dependencies — safe for unit tests without SUPABASE_*.
 */

export type OrganizationClientAccessScopeKind = 'OFFICE' | 'ASSIGNED_TO_SELF';

export type OrganizationClientAccessScope = {
  organization_id: string;
  viewer_user_id: string;
  role_code: string;
  kind: OrganizationClientAccessScopeKind;
  /** Cache / identity key — never a display name. */
  access_scope_key: string;
  /** Null = all org clients (OFFICE). Empty array = no clients. */
  authorized_client_ids: string[] | null;
};

export function roleHasOfficeClientAccess(roleCode: string | null | undefined): boolean {
  const code = String(roleCode ?? '').trim().toLowerCase();
  return code === 'owner' || code === 'admin';
}

/** Owner/Admin may assign/reassign/unassign responsible handlers. */
export function canManageClientHandlerAssignment(roleCode: string | null | undefined): boolean {
  return roleHasOfficeClientAccess(roleCode);
}

export function buildClientAccessScopeKey(params: {
  kind: OrganizationClientAccessScopeKind;
  viewerUserId: string;
}): string {
  if (params.kind === 'OFFICE') return 'OFFICE';
  return `ASSIGNED:${params.viewerUserId}`;
}

export function clientIdIsAuthorized(
  scope: OrganizationClientAccessScope,
  clientId: string,
): boolean {
  if (scope.kind === 'OFFICE' || scope.authorized_client_ids === null) return true;
  return scope.authorized_client_ids.includes(clientId);
}

export function filterAuthorizedClientIds(
  scope: OrganizationClientAccessScope,
  clientIds: string[],
): string[] {
  if (scope.kind === 'OFFICE' || scope.authorized_client_ids === null) return clientIds;
  const allow = new Set(scope.authorized_client_ids);
  return clientIds.filter((id) => allow.has(id));
}
