/**
 * Pure helpers for organization client access scope (Stage 3).
 * No DB / env dependencies — safe for unit tests without SUPABASE_*.
 */

export type OrganizationClientAccessScopeKind = 'OFFICE' | 'MEMBER_ALL' | 'ASSIGNED_TO_SELF';

export type MemberClientAccessMode = 'all' | 'selected';

export type OrganizationClientAccessScope = {
  organization_id: string;
  viewer_user_id: string;
  role_code: string;
  kind: OrganizationClientAccessScopeKind;
  /** Cache / identity key — never a display name. */
  access_scope_key: string;
  /**
   * Null = unrestricted id set (OFFICE, or Staff/Viewer ALL).
   * Empty array = fail closed. Non-empty = explicit allow-list (SELECTED grants).
   */
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
  if (params.kind === 'MEMBER_ALL') return `ALL:${params.viewerUserId}`;
  return `ASSIGNED:${params.viewerUserId}`;
}

/**
 * Visibility decision for a non-office member.
 * Owner/Admin are not decided here — the resolver returns OFFICE before this.
 * Missing or invalid policy is fail closed to assigned-only empty set.
 * Handler assignment is not an input.
 */
export function scopeForMemberClientPolicy(params: {
  organizationId: string;
  viewerUserId: string;
  roleCode: string;
  accessMode: string | null | undefined;
  grantedActiveClientIds: readonly string[];
}): OrganizationClientAccessScope {
  const organization_id = String(params.organizationId ?? '').trim();
  const viewer_user_id = String(params.viewerUserId ?? '').trim();
  const role_code = String(params.roleCode ?? '').trim().toLowerCase();
  const mode = String(params.accessMode ?? '').trim().toLowerCase();
  if (mode === 'all') {
    return {
      organization_id,
      viewer_user_id,
      role_code,
      kind: 'MEMBER_ALL',
      access_scope_key: buildClientAccessScopeKey({ kind: 'MEMBER_ALL', viewerUserId: viewer_user_id }),
      authorized_client_ids: null,
    };
  }
  const granted =
    mode === 'selected'
      ? [...new Set(params.grantedActiveClientIds.map((id) => String(id).trim()).filter(Boolean))].sort()
      : [];
  return {
    organization_id,
    viewer_user_id,
    role_code,
    kind: 'ASSIGNED_TO_SELF',
    access_scope_key: buildClientAccessScopeKey({
      kind: 'ASSIGNED_TO_SELF',
      viewerUserId: viewer_user_id,
    }),
    authorized_client_ids: granted,
  };
}

/**
 * Migration backfill. Active Staff/Viewer become SELECTED for their current
 * handler assignments only. Never ALL. Owner/Admin get no policy row.
 */
export function backfillStaffViewerClientAccess(params: {
  roleCode: string;
  membershipStatus: string;
  assignedClientIds: readonly string[];
}): { access_mode: 'selected'; grant_client_ids: string[] } | null {
  const role = String(params.roleCode ?? '').trim().toLowerCase();
  const status = String(params.membershipStatus ?? '').trim().toLowerCase();
  if (status !== 'active') return null;
  if (role !== 'staff' && role !== 'viewer') return null;
  return {
    access_mode: 'selected',
    grant_client_ids: [...new Set(params.assignedClientIds.map((id) => String(id).trim()).filter(Boolean))].sort(),
  };
}

export function canManageMemberClientAccess(roleCode: string | null | undefined): boolean {
  return roleHasOfficeClientAccess(roleCode);
}

const MEMBER_CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Normalize command input. ALL drops any selected ids. Duplicates collapse. Invalid ids throw. */
export function normalizeMemberClientAccessCommand(body: {
  access_mode?: unknown;
  selected_client_ids?: unknown;
}): { accessMode: 'all' | 'selected'; selectedClientIds: string[] } | { error: string } {
  const accessMode = String(body.access_mode ?? '').trim().toLowerCase();
  if (accessMode !== 'all' && accessMode !== 'selected') {
    return { error: 'access_mode must be all or selected' };
  }
  if (accessMode === 'all') return { accessMode, selectedClientIds: [] };
  const list = Array.isArray(body.selected_client_ids) ? body.selected_client_ids : [];
  if (list.length > 2000) return { error: 'Too many selected clients' };
  const ids: string[] = [];
  for (const value of list) {
    const id = String(value ?? '').trim().toLowerCase();
    if (!MEMBER_CLIENT_ID_RE.test(id)) return { error: 'selected_client_ids must be client UUIDs' };
    ids.push(id);
  }
  return { accessMode: 'selected', selectedClientIds: [...new Set(ids)].sort() };
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

/** Drop rows whose client is outside a Staff/Viewer allow-list. Null allow-list keeps every row. */
export function restrictClientScopedRows<T>(
  rows: readonly T[],
  clientIdOf: (row: T) => string | null | undefined,
  authorizedClientIds: readonly string[] | null,
): T[] {
  if (authorizedClientIds == null) return [...rows];
  const allow = new Set(authorizedClientIds);
  return rows.filter((row) => allow.has(String(clientIdOf(row) ?? '').trim()));
}
