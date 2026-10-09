/**
 * Client Operations workspace resolver (Stage 4 + Stage 5.2).
 * Staff/Viewer MY uses their Stage 5.1 visibility policy.
 * Owner/Admin OFFICE is the office client set.
 * Owner/Admin MY stays a handler responsibility projection.
 * Owner/Admin STAFF uses the selected employee's Stage 5.1 visibility policy.
 * assigned_handler_user_id is not visibility for STAFF.
 */

import { supabaseAdmin } from '../../db/client.js';
import { badRequest, forbidden } from '../../shared/errors.js';
import type { RequestContext } from '../../shared/context.js';
import { loadMemberDisplayNamesByUserIds } from '../memberships/organization-membership-access.js';
import {
  loadAssignedClientIdsForHandler,
  resolveOrganizationClientAccessScope,
  resolveOrganizationClientAccessScopeFromContext,
  type OrganizationClientAccessScope,
} from './organization-client-access.js';
import {
  buildMyWorkspaceOption,
  buildOfficeWorkspaceOption,
  buildStaffWorkspaceOption,
  canInspectOrganizationWorkspaces,
  defaultWorkspaceScopeKind,
  normalizeRequestedWorkspaceScopeKind,
  roleIsSelectableWorkspaceSubject,
  workspaceProjectionAccessScopeKey,
  type ClientOperationsWorkspaceOption,
  type ClientOperationsWorkspaceRequested,
  type ClientOperationsWorkspaceScopeKind,
} from './client-operations-workspace.pure.js';

export type {
  ClientOperationsWorkspaceOption,
  ClientOperationsWorkspaceRequested,
  ClientOperationsWorkspaceScopeKind,
};

export type ClientOperationsWorkspaceResolution = {
  viewer_user_id: string;
  scope_kind: ClientOperationsWorkspaceScopeKind;
  workspace_subject_user_id: string | null;
  /** Cache / materialization identity — OFFICE or ASSIGNED:<subjectId>. */
  access_scope_key: string;
  /** Null = unrestricted ids for this projection; empty = fail closed; else allow-list. */
  authorized_client_ids: string[] | null;
  label_he: string;
  allowed_scopes: ClientOperationsWorkspaceOption[];
  available_workspace_subjects: Array<{
    user_id: string;
    display_name: string;
    role_code: string;
  }>;
};

async function loadActiveOperationalWorkspaceSubjects(
  organizationId: string,
): Promise<Array<{ user_id: string; role_code: string; display_name: string }>> {
  const { data, error } = await supabaseAdmin
    .from('organization_memberships')
    .select('user_id, role_code')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .in('role_code', ['admin', 'staff']);
  if (error) throw new Error(error.message ?? 'Failed to load workspace subjects');

  const rows = (data ?? []) as Array<{ user_id: string; role_code: string }>;
  const names = await loadMemberDisplayNamesByUserIds(rows.map((r) => r.user_id));
  return rows
    .map((r) => ({
      user_id: r.user_id,
      role_code: r.role_code,
      display_name: names.get(r.user_id) ?? r.user_id,
    }))
    .filter((r) => roleIsSelectableWorkspaceSubject(r.role_code))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, 'he'));
}

function buildAllowedScopes(params: {
  roleCode: string;
  subjects: Array<{ user_id: string; role_code: string; display_name: string }>;
}): ClientOperationsWorkspaceOption[] {
  if (!canInspectOrganizationWorkspaces(params.roleCode)) {
    return [buildMyWorkspaceOption()];
  }
  return [
    buildOfficeWorkspaceOption(),
    buildMyWorkspaceOption(),
    ...params.subjects.map((s) =>
      buildStaffWorkspaceOption({
        userId: s.user_id,
        displayName: s.display_name,
        roleCode: s.role_code,
      }),
    ),
  ];
}

/**
 * Resolve authorized CO workspace for the authenticated viewer.
 * Requested scope is validated; never trusted raw.
 */
export async function resolveClientOperationsWorkspaceScope(params: {
  organizationId: string;
  viewerUserId: string;
  roleCode: string | null | undefined;
  requested?: ClientOperationsWorkspaceRequested | null;
  /** Optional preloaded Stage 3 ACL. */
  stage3Access?: OrganizationClientAccessScope;
}): Promise<{
  stage3: OrganizationClientAccessScope;
  workspace: ClientOperationsWorkspaceResolution;
  /** Effective materialization ACL (Stage 3 ∩ workspace projection). */
  materializationAccess: OrganizationClientAccessScope;
}> {
  const organizationId = String(params.organizationId ?? '').trim();
  const viewerUserId = String(params.viewerUserId ?? '').trim();
  const roleCode = String(params.roleCode ?? '').trim().toLowerCase();
  if (!organizationId || !viewerUserId) {
    throw forbidden('Organization and viewer required for workspace scope');
  }

  const stage3 =
    params.stage3Access ??
    (await resolveOrganizationClientAccessScope({
      organizationId,
      viewerUserId,
      roleCode,
    }));

  const canInspect = canInspectOrganizationWorkspaces(roleCode);
  const subjects = canInspect ? await loadActiveOperationalWorkspaceSubjects(organizationId) : [];
  const allowed_scopes = buildAllowedScopes({ roleCode, subjects });
  const available_workspace_subjects = subjects.map((s) => ({
    user_id: s.user_id,
    display_name: s.display_name,
    role_code: s.role_code,
  }));

  const requestedKind =
    normalizeRequestedWorkspaceScopeKind(params.requested?.workspace_scope) ??
    defaultWorkspaceScopeKind(roleCode);
  const requestedSubjectRaw = String(params.requested?.workspace_subject_user_id ?? '').trim() || null;

  let scope_kind: ClientOperationsWorkspaceScopeKind = requestedKind;
  let workspace_subject_user_id: string | null = null;
  let selectedSubjectRole: string | null = null;
  let label_he = '';

  if (!canInspect) {
    // Staff/Viewer: MY only — reject broadening attempts. Subject is always the actor.
    if (requestedKind === 'OFFICE' || requestedKind === 'STAFF') {
      throw forbidden('Workspace scope not allowed', 'WORKSPACE_SCOPE_FORBIDDEN');
    }
    scope_kind = 'MY';
    workspace_subject_user_id = viewerUserId;
    label_he = 'הלקוחות שלי';
  } else if (scope_kind === 'OFFICE') {
    workspace_subject_user_id = null;
    label_he = 'כל המשרד';
  } else if (scope_kind === 'MY') {
    workspace_subject_user_id = viewerUserId;
    label_he = 'הלקוחות שלי';
  } else {
    // STAFF — active admin/staff in this organization only. Actor stays the viewer.
    if (!requestedSubjectRaw) {
      throw badRequest('workspace_subject_user_id required for staff workspace', 'WORKSPACE_SUBJECT_REQUIRED');
    }
    const subject = subjects.find((s) => s.user_id === requestedSubjectRaw);
    if (!subject) {
      // Cross-org / unknown / revoked / viewer — do not leak.
      throw forbidden('Workspace subject not available', 'WORKSPACE_SUBJECT_FORBIDDEN');
    }
    workspace_subject_user_id = subject.user_id;
    selectedSubjectRole = subject.role_code;
    label_he = subject.display_name;
  }

  let access_scope_key: string;
  let authorized_client_ids: string[] | null;
  let materializationKind: OrganizationClientAccessScope['kind'];
  if (!canInspect) {
    // Staff/Viewer MY is the visibility policy. Do not intersect with handler assignment.
    access_scope_key = stage3.access_scope_key;
    authorized_client_ids =
      stage3.authorized_client_ids === null ? null : [...stage3.authorized_client_ids];
    materializationKind = stage3.kind;
  } else if (scope_kind === 'OFFICE') {
    // Must not broaden Stage 3 — Owner/Admin Stage 3 is already OFFICE.
    if (stage3.kind !== 'OFFICE') {
      throw forbidden('Workspace scope not allowed', 'WORKSPACE_SCOPE_FORBIDDEN');
    }
    access_scope_key = workspaceProjectionAccessScopeKey({
      scopeKind: 'OFFICE',
      workspaceSubjectUserId: null,
    });
    authorized_client_ids = null;
    materializationKind = 'OFFICE';
  } else if (scope_kind === 'MY') {
    // Owner/Admin MY remains a responsibility projection (handler), never a grant.
    const subjectId = workspace_subject_user_id!;
    const assigned = await loadAssignedClientIdsForHandler(organizationId, subjectId);
    access_scope_key = workspaceProjectionAccessScopeKey({
      scopeKind: 'MY',
      workspaceSubjectUserId: subjectId,
    });
    if (stage3.kind === 'OFFICE') {
      authorized_client_ids = assigned;
    } else {
      const allow = new Set(stage3.authorized_client_ids ?? []);
      authorized_client_ids = assigned.filter((id) => allow.has(id));
    }
    materializationKind = 'ASSIGNED_TO_SELF';
  } else {
    // STAFF — employee visibility ACL, not handler.
    const employeeScope = await resolveOrganizationClientAccessScope({
      organizationId,
      viewerUserId: workspace_subject_user_id!,
      roleCode: selectedSubjectRole,
    });
    access_scope_key = employeeScope.access_scope_key;
    authorized_client_ids =
      employeeScope.authorized_client_ids === null ? null : [...employeeScope.authorized_client_ids];
    materializationKind = employeeScope.kind;
  }

  const workspace: ClientOperationsWorkspaceResolution = {
    viewer_user_id: viewerUserId,
    scope_kind,
    workspace_subject_user_id,
    access_scope_key,
    authorized_client_ids,
    label_he,
    allowed_scopes,
    available_workspace_subjects,
  };

  const materializationAccess: OrganizationClientAccessScope = {
    organization_id: organizationId,
    viewer_user_id: viewerUserId,
    role_code: roleCode,
    kind: materializationKind,
    access_scope_key,
    authorized_client_ids,
  };

  return { stage3, workspace, materializationAccess };
}

export async function resolveClientOperationsWorkspaceScopeFromContext(
  ctx: RequestContext,
  requested?: ClientOperationsWorkspaceRequested | null,
): Promise<{
  stage3: OrganizationClientAccessScope;
  workspace: ClientOperationsWorkspaceResolution;
  materializationAccess: OrganizationClientAccessScope;
}> {
  const organizationId = ctx.organizationId;
  if (!organizationId) throw forbidden('Organization context required');
  const stage3 = await resolveOrganizationClientAccessScopeFromContext(ctx);
  return resolveClientOperationsWorkspaceScope({
    organizationId,
    viewerUserId: ctx.user.id,
    roleCode: ctx.membership?.roleCode ?? null,
    requested,
    stage3Access: stage3,
  });
}

export function workspaceAggregateContract(workspace: ClientOperationsWorkspaceResolution): {
  scope_kind: ClientOperationsWorkspaceScopeKind;
  viewer_user_id: string;
  workspace_subject_user_id: string | null;
  access_scope_key: string;
  label_he: string;
  allowed_scopes: ClientOperationsWorkspaceOption[];
  available_workspace_subjects: ClientOperationsWorkspaceResolution['available_workspace_subjects'];
  selector_visible: boolean;
} {
  return {
    scope_kind: workspace.scope_kind,
    viewer_user_id: workspace.viewer_user_id,
    workspace_subject_user_id: workspace.workspace_subject_user_id,
    access_scope_key: workspace.access_scope_key,
    label_he: workspace.label_he,
    allowed_scopes: workspace.allowed_scopes,
    available_workspace_subjects: workspace.available_workspace_subjects,
    selector_visible: workspace.allowed_scopes.length > 1,
  };
}
