/**
 * Pure Client Operations workspace scope helpers (Stage 4).
 * viewer ≠ workspace subject — no impersonation.
 */

import {
  buildClientAccessScopeKey,
  roleHasOfficeClientAccess,
  type OrganizationClientAccessScopeKind,
} from './organization-client-access.pure.js';

export type ClientOperationsWorkspaceScopeKind = 'OFFICE' | 'MY' | 'STAFF';

export type ClientOperationsWorkspaceOption = {
  scope_kind: ClientOperationsWorkspaceScopeKind;
  /** Present for STAFF options and for MY when rendering as self subject. */
  subject_user_id: string | null;
  label_he: string;
  role_code: string | null;
};

export type ClientOperationsWorkspaceRequested = {
  workspace_scope?: string | null;
  workspace_subject_user_id?: string | null;
};

export function canInspectOrganizationWorkspaces(roleCode: string | null | undefined): boolean {
  // V1: Owner + Admin may inspect OFFICE / MY / STAFF (paid operational management).
  return roleHasOfficeClientAccess(roleCode);
}

export function defaultWorkspaceScopeKind(
  roleCode: string | null | undefined,
): ClientOperationsWorkspaceScopeKind {
  return canInspectOrganizationWorkspaces(roleCode) ? 'OFFICE' : 'MY';
}

export function normalizeRequestedWorkspaceScopeKind(
  raw: string | null | undefined,
): ClientOperationsWorkspaceScopeKind | null {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!v) return null;
  if (v === 'office') return 'OFFICE';
  if (v === 'my') return 'MY';
  if (v === 'staff') return 'STAFF';
  return null;
}

/** Roles selectable as STAFF workspace subjects (active operational members). */
export function roleIsSelectableWorkspaceSubject(roleCode: string | null | undefined): boolean {
  const code = String(roleCode ?? '')
    .trim()
    .toLowerCase();
  return code === 'admin' || code === 'staff';
}

export function workspaceProjectionAccessScopeKey(params: {
  scopeKind: ClientOperationsWorkspaceScopeKind;
  workspaceSubjectUserId: string | null;
}): string {
  if (params.scopeKind === 'OFFICE') {
    return buildClientAccessScopeKey({ kind: 'OFFICE', viewerUserId: '' });
  }
  const subject = String(params.workspaceSubjectUserId ?? '').trim();
  return buildClientAccessScopeKey({
    kind: 'ASSIGNED_TO_SELF',
    viewerUserId: subject,
  });
}

export function workspaceProjectionKind(
  scopeKind: ClientOperationsWorkspaceScopeKind,
): OrganizationClientAccessScopeKind {
  return scopeKind === 'OFFICE' ? 'OFFICE' : 'ASSIGNED_TO_SELF';
}

export function buildOfficeWorkspaceOption(): ClientOperationsWorkspaceOption {
  return {
    scope_kind: 'OFFICE',
    subject_user_id: null,
    label_he: 'כל המשרד',
    role_code: null,
  };
}

export function buildMyWorkspaceOption(): ClientOperationsWorkspaceOption {
  return {
    scope_kind: 'MY',
    subject_user_id: null,
    label_he: 'הלקוחות שלי',
    role_code: null,
  };
}

export function buildStaffWorkspaceOption(params: {
  userId: string;
  displayName: string;
  roleCode: string;
}): ClientOperationsWorkspaceOption {
  return {
    scope_kind: 'STAFF',
    subject_user_id: params.userId,
    label_he: params.displayName,
    role_code: params.roleCode,
  };
}
