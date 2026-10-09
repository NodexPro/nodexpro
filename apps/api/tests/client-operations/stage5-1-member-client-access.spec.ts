/**
 * Stage 5.1 — client visibility policy is separate from handler responsibility.
 * Pure decisions + source contracts. No live Supabase required.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  backfillStaffViewerClientAccess,
  clientIdIsAuthorized,
  filterAuthorizedClientIds,
  roleHasOfficeClientAccess,
  normalizeMemberClientAccessCommand,
  scopeForMemberClientPolicy,
  type OrganizationClientAccessScope,
} from '../../src/domains/client-operations/organization-client-access.pure.js';
import { materializeClientOperationsManualRows } from '../../src/domains/client-operations/client-operations-manual-rows.pure.js';
import { canInspectOrganizationWorkspaces } from '../../src/domains/client-operations/client-operations-workspace.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function officeScope(role: 'owner' | 'admin'): OrganizationClientAccessScope {
  return {
    organization_id: 'org',
    viewer_user_id: role,
    role_code: role,
    kind: 'OFFICE',
    access_scope_key: 'OFFICE',
    authorized_client_ids: null,
  };
}

test('1-2 Owner and Admin office scope sees every client id', () => {
  for (const role of ['owner', 'admin'] as const) {
    assert.equal(roleHasOfficeClientAccess(role), true);
    const scope = officeScope(role);
    assert.equal(clientIdIsAuthorized(scope, 'c1'), true);
    assert.equal(clientIdIsAuthorized(scope, 'future'), true);
    assert.deepEqual(filterAuthorizedClientIds(scope, ['c1', 'c2']), ['c1', 'c2']);
  }
});

test('3-5 Staff and Viewer SELECTED see only grants; empty sees zero', () => {
  for (const role of ['staff', 'viewer']) {
    const selected = scopeForMemberClientPolicy({
      organizationId: 'org',
      viewerUserId: 'u',
      roleCode: role,
      accessMode: 'selected',
      grantedActiveClientIds: ['b', 'a', 'a'],
    });
    assert.equal(selected.kind, 'ASSIGNED_TO_SELF');
    assert.deepEqual(selected.authorized_client_ids, ['a', 'b']);
    assert.equal(clientIdIsAuthorized(selected, 'a'), true);
    assert.equal(clientIdIsAuthorized(selected, 'c'), false);
    const empty = scopeForMemberClientPolicy({
      organizationId: 'org',
      viewerUserId: 'u',
      roleCode: role,
      accessMode: 'selected',
      grantedActiveClientIds: [],
    });
    assert.deepEqual(empty.authorized_client_ids, []);
    assert.equal(clientIdIsAuthorized(empty, 'a'), false);
    assert.deepEqual(filterAuthorizedClientIds(empty, ['a']), []);
  }
});

test('6-8 ALL sees current and later clients; SELECTED does not see a later client', () => {
  const all = scopeForMemberClientPolicy({
    organizationId: 'org',
    viewerUserId: 'u',
    roleCode: 'staff',
    accessMode: 'all',
    grantedActiveClientIds: [],
  });
  assert.equal(all.kind, 'MEMBER_ALL');
  assert.equal(all.authorized_client_ids, null);
  assert.equal(all.access_scope_key, 'ALL:u');
  assert.equal(clientIdIsAuthorized(all, 'existing'), true);
  assert.equal(clientIdIsAuthorized(all, 'created-later'), true);
  const selected = scopeForMemberClientPolicy({
    organizationId: 'org',
    viewerUserId: 'u',
    roleCode: 'viewer',
    accessMode: 'selected',
    grantedActiveClientIds: ['existing'],
  });
  assert.equal(clientIdIsAuthorized(selected, 'created-later'), false);
});

test('9-10 handler without grant is hidden; grant without handler is visible', () => {
  const handlerOnly = scopeForMemberClientPolicy({
    organizationId: 'org',
    viewerUserId: 'worker',
    roleCode: 'staff',
    accessMode: 'selected',
    grantedActiveClientIds: [],
  });
  assert.equal(clientIdIsAuthorized(handlerOnly, 'client-a'), false);
  const grantOnly = scopeForMemberClientPolicy({
    organizationId: 'org',
    viewerUserId: 'worker',
    roleCode: 'staff',
    accessMode: 'selected',
    grantedActiveClientIds: ['client-a'],
  });
  assert.equal(clientIdIsAuthorized(grantOnly, 'client-a'), true);
});

test('missing policy fails closed and does not use a handler id', () => {
  const missing = scopeForMemberClientPolicy({
    organizationId: 'org',
    viewerUserId: 'worker',
    roleCode: 'staff',
    accessMode: null,
    grantedActiveClientIds: ['should-be-ignored'],
  });
  assert.deepEqual(missing.authorized_client_ids, []);
  assert.equal(clientIdIsAuthorized(missing, 'should-be-ignored'), false);
});

test('11-14 command input: staff cannot describe a self-grant; owner can name a mode', () => {
  const rejected = normalizeMemberClientAccessCommand({ access_mode: 'office' });
  assert.ok('error' in rejected);
  const selected = normalizeMemberClientAccessCommand({
    access_mode: 'selected',
    selected_client_ids: [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ],
  });
  assert.ok(!('error' in selected));
  if (!('error' in selected)) {
    assert.equal(selected.accessMode, 'selected');
    assert.equal(selected.selectedClientIds.length, 1);
  }
  const all = normalizeMemberClientAccessCommand({
    access_mode: 'all',
    selected_client_ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
  });
  assert.ok(!('error' in all));
  if (!('error' in all)) assert.deepEqual(all.selectedClientIds, []);
  const badId = normalizeMemberClientAccessCommand({
    access_mode: 'selected',
    selected_client_ids: ['not-a-uuid'],
  });
  assert.ok('error' in badId);
});

test('26-27 Staff and Viewer cannot inspect office or another subject', () => {
  assert.equal(canInspectOrganizationWorkspaces('staff'), false);
  assert.equal(canInspectOrganizationWorkspaces('viewer'), false);
  assert.equal(canInspectOrganizationWorkspaces('owner'), true);
  assert.equal(canInspectOrganizationWorkspaces('admin'), true);
});

test('28-31 backfill is SELECTED for active staff/viewer, empty when unassigned, never ALL, no owner row', () => {
  const staff = backfillStaffViewerClientAccess({
    roleCode: 'staff',
    membershipStatus: 'active',
    assignedClientIds: ['c2', 'c1', 'c1'],
  });
  assert.deepEqual(staff, { access_mode: 'selected', grant_client_ids: ['c1', 'c2'] });
  const none = backfillStaffViewerClientAccess({
    roleCode: 'viewer',
    membershipStatus: 'active',
    assignedClientIds: [],
  });
  assert.deepEqual(none, { access_mode: 'selected', grant_client_ids: [] });
  assert.equal(
    backfillStaffViewerClientAccess({ roleCode: 'owner', membershipStatus: 'active', assignedClientIds: ['c1'] }),
    null,
  );
  assert.equal(
    backfillStaffViewerClientAccess({ roleCode: 'admin', membershipStatus: 'active', assignedClientIds: ['c1'] }),
    null,
  );
  assert.equal(
    backfillStaffViewerClientAccess({ roleCode: 'staff', membershipStatus: 'revoked', assignedClientIds: ['c1'] }),
    null,
  );
  assert.notEqual(staff?.access_mode, 'all');
});

test('32 manual rows stay client_id null and are not client ACL records', () => {
  const rows = materializeClientOperationsManualRows({
    columnKeys: ['notes'],
    valuesBySlotColumn: new Map(),
  });
  assert.equal(rows.length, 5);
  for (const row of rows) {
    assert.equal(row.client_id, null);
    assert.equal(row.row_kind, 'manual');
    assert.match(row.row_key, /^manual:0[1-5]$/);
  }
});

test('source contracts — resolver, export, command, backfill, lifecycle, manual rows', () => {
  const access = readRepo('apps/api/src/domains/client-operations/organization-client-access.ts');
  assert.match(access, /organization_member_client_access/);
  assert.match(access, /organization_member_client_grants/);
  assert.match(access, /is_archived', false/);
  assert.match(access, /Do not fall back to assigned_handler_user_id/);
  assert.match(access, /fail closed to assigned-only/);
  assert.doesNotMatch(
    access.slice(access.indexOf('export async function resolveOrganizationClientAccessScope')),
    /loadAssignedClientIdsForHandler/,
  );

  const exportSvc = readRepo('apps/api/src/domains/clients/client-import-export.service.ts');
  const fullExport = exportSvc.slice(
    exportSvc.indexOf('export async function exportClientsCsv'),
    exportSvc.indexOf('export async function exportSelectedClientsCsv'),
  );
  assert.match(fullExport, /resolveOrganizationClientAccessScopeFromContext/);
  assert.match(fullExport, /filterAuthorizedClientIds/);
  assert.match(fullExport, /authorized_client_ids/);
  assert.match(exportSvc, /filterAuthorizedClientIds/);

  const clients = readRepo('apps/api/src/domains/clients/clients.service.ts');
  assert.match(clients, /authorized_client_ids/);
  assert.match(clients, /filterAuthorizedClientIds/);
  assert.match(clients, /MEMBER_ALL/);

  const workspace = readRepo('apps/api/src/domains/client-operations/client-operations-workspace.service.ts');
  assert.match(workspace, /WORKSPACE_SCOPE_FORBIDDEN/);
  assert.match(workspace, /Do not intersect with handler assignment/);

  const todo = readRepo('apps/api/src/domains/client-operations/client-operations-todo.service.ts');
  assert.match(todo, /resolveOrganizationClientAccessScope/);
  assert.match(todo, /authorizedClientIds/);
  assert.doesNotMatch(todo, /loadAssignedClientIdsForHandler/);

  const handler = readRepo('apps/api/src/domains/client-operations/client-operations.service.ts');
  assert.match(handler, /does not grant or remove visibility/);
  assert.doesNotMatch(
    handler.slice(handler.indexOf('export async function assignClientHandler')),
    /organization_member_client_grants/,
  );

  const command = readRepo('apps/api/src/domains/memberships/member-client-access.service.ts');
  assert.match(command, /set_organization_member_client_access/);
  assert.match(command, /canManageMemberClientAccess/);
  assert.doesNotMatch(command, /assigned_handler_user_id/);

  const routes = readRepo('apps/api/src/domains/memberships/memberships.routes.ts');
  assert.match(routes, /set_member_client_access/);
  assert.match(routes, /members:write/);

  const clientRoutes = readRepo('apps/api/src/domains/clients/clients.routes.ts');
  assert.match(clientRoutes, /requireAuthorizedClientParam/);
  const coRoutes = readRepo('apps/api/src/domains/client-operations/client-operations.routes.ts');
  assert.match(coRoutes, /router\.param\('clientId'/);

  const history = readRepo('apps/api/src/domains/client-operations/client-history-tab.service.ts');
  assert.match(history, /assertCanAccessClientFromContext\(ctx, clientId\)/);

  const manual = readRepo('apps/api/src/domains/client-operations/client-operations-manual-rows.pure.ts');
  assert.match(manual, /client_id: null/);
  assert.match(manual, /workspace-scoped/);
  const manualSvc = readRepo('apps/api/src/domains/client-operations/client-operations-manual-rows.service.ts');
  assert.doesNotMatch(manualSvc, /client_id/);

  const audit = readRepo('apps/api/src/shared/audit-events.ts');
  assert.match(audit, /member_client_access\.set/);

  const sql = readRepo('supabase/migrations/184_organization_member_client_access.sql');
  const backfill = sql.slice(sql.indexOf('-- BACKFILL START'), sql.indexOf('-- BACKFILL END'));
  assert.match(backfill, /'selected'/);
  assert.match(backfill, /assigned_handler_user_id/);
  assert.match(backfill, /role_code in \('staff', 'viewer'\)/);
  assert.match(backfill, /m\.status = 'active'/);
  assert.doesNotMatch(backfill, /'all'/);
  assert.match(sql, /access_mode in \('all', 'selected'\)/);
  assert.match(sql, /MEMBER_CLIENT_ACCESS_CROSS_ORG_CLIENT/);
  assert.match(sql, /MEMBER_CLIENT_ACCESS_CROSS_ORG_MEMBER/);
  assert.match(sql, /MEMBER_CLIENT_ACCESS_ARCHIVED_CLIENT/);
  assert.match(sql, /MEMBER_CLIENT_ACCESS_FORBIDDEN/);
  assert.match(sql, /member_client_access\.set/);
  assert.match(sql, /revoke all on table public.organization_member_client_access from anon, authenticated/);
  assert.match(sql, /delete_member_client_grants_for_archived_client/);
  assert.doesNotMatch(sql, /drop column|drop table/i);
  assert.doesNotMatch(sql, /purchased_additional_staff_seats/);
  assert.doesNotMatch(sql, /update public.client_operational_profiles/);
  assert.doesNotMatch(sql, /update public.organization_memberships/);
});
