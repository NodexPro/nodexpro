/**
 * Stage 5.2 — worker-scoped manual rows. Pure decisions and source contracts.
 * Live Supabase is not required.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLIENT_OPERATIONS_MANUAL_OFFICE_SUBJECT_USER_ID,
  backfillExistingManualRowsToOfficeWorkspace,
  manualRowWorkspaceKeyForScope,
  manualRowsShareWorkspace,
  manualWorkspaceCacheKey,
  materializeClientOperationsManualRows,
  planManualRowCarryForward,
} from '../../src/domains/client-operations/client-operations-manual-rows.pure.js';
import { scopeForMemberClientPolicy } from '../../src/domains/client-operations/organization-client-access.pure.js';
import { buildClientOperationsRegistryMaterializationCacheKey } from '../../src/domains/client-operations/client-operations-registry-materialization-cache.js';
import { normalizeClientOperationsRegistryBusinessFilterQuery } from '../../src/domains/client-operations/client-operations-registry-filters.pure.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

const STAFF_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const STAFF_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const OWNER = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';

test('1 existing manual data backfills to OFFICE only and ignores updated_by', () => {
  const office = backfillExistingManualRowsToOfficeWorkspace();
  assert.deepEqual(office, {
    workspace_kind: 'office',
    subject_user_id: CLIENT_OPERATIONS_MANUAL_OFFICE_SUBJECT_USER_ID,
  });
  const sql = readRepo('supabase/migrations/185_client_operations_manual_row_workspace.sql');
  const backfill = sql.slice(sql.indexOf('-- BACKFILL START'), sql.indexOf('-- BACKFILL END'));
  assert.match(backfill, /workspace_kind = 'office'/);
  assert.match(backfill, /00000000-0000-0000-0000-000000000000/);
  assert.doesNotMatch(backfill, /insert into/i);
  assert.doesNotMatch(backfill, /updated_by/);
});

test('2-3 Staff A and Staff B start as independent empty presentation slots', () => {
  const a = manualRowWorkspaceKeyForScope({ scopeKind: 'MY', workspaceSubjectUserId: STAFF_A });
  const b = manualRowWorkspaceKeyForScope({ scopeKind: 'MY', workspaceSubjectUserId: STAFF_B });
  assert.equal(a.workspace_kind, 'member');
  assert.equal(b.workspace_kind, 'member');
  assert.notEqual(a.subject_user_id, b.subject_user_id);
  assert.equal(manualRowsShareWorkspace(a, b), false);
  const rowsA = materializeClientOperationsManualRows({
    columnKeys: ['notes'],
    valuesBySlotColumn: new Map(),
  });
  const rowsB = materializeClientOperationsManualRows({
    columnKeys: ['notes'],
    valuesBySlotColumn: new Map(),
  });
  assert.equal(rowsA.length, 5);
  assert.equal(rowsB.length, 5);
  assert.ok(rowsA.every((row) => row.cells.notes === '' && row.client_id === null));
  assert.ok(rowsB.every((row) => row.cells.notes === ''));
});

test('4-7 A and B manual values do not cross reads or writes', () => {
  const a = manualRowWorkspaceKeyForScope({ scopeKind: 'STAFF', workspaceSubjectUserId: STAFF_A });
  const b = manualRowWorkspaceKeyForScope({ scopeKind: 'STAFF', workspaceSubjectUserId: STAFF_B });
  const planA = planManualRowCarryForward({
    previousValues: [{ slot: 1, column_key: 'notes', value_text: 'from-a' }],
  });
  const planB = planManualRowCarryForward({
    previousValues: [{ slot: 1, column_key: 'notes', value_text: 'from-b' }],
  });
  assert.equal(planA[0]?.value_text, 'from-a');
  assert.equal(planB[0]?.value_text, 'from-b');
  assert.notEqual(planA[0]?.value_text, planB[0]?.value_text);
  const service = readRepo('apps/api/src/domains/client-operations/client-operations-manual-rows.service.ts');
  assert.match(service, /\.eq\('workspace_kind', input\.workspace\.workspace_kind\)/);
  assert.match(service, /\.eq\('subject_user_id', input\.workspace\.subject_user_id\)/);
  assert.match(service, /\.eq\('workspace_kind', workspace\.workspace_kind\)/);
  assert.match(service, /\.eq\('subject_user_id', workspace\.subject_user_id\)/);
});

test('8 Staff cannot request OFFICE manual rows', () => {
  const workspace = readRepo('apps/api/src/domains/client-operations/client-operations-workspace.service.ts');
  const staff = workspace.slice(
    workspace.indexOf('if (!canInspect)'),
    workspace.indexOf("else if (scope_kind === 'OFFICE')"),
  );
  assert.match(staff, /requestedKind === 'OFFICE'/);
  assert.match(staff, /WORKSPACE_SCOPE_FORBIDDEN/);
  assert.match(staff, /workspace_subject_user_id = viewerUserId/);
});

test('9 Staff cannot substitute subject_user_id on a manual write', () => {
  const command = readRepo(
    'apps/api/src/domains/client-operations/client-operations-registry-custom-columns.service.ts',
  );
  const write = command.slice(
    command.indexOf("command === 'set_client_operations_manual_row_cell_value'"),
    command.indexOf("command === 'copy_client_operations_user_period_data'"),
  );
  assert.match(write, /queryFrom\(body\.query\)/);
  assert.match(write, /requestedWorkspace:/);
  assert.doesNotMatch(write, /body\.subject_user_id/);
  assert.doesNotMatch(write, /body\.workspace_subject_user_id/);
  const service = readRepo('apps/api/src/domains/client-operations/client-operations-manual-rows.service.ts');
  assert.match(service, /resolveManualRowWorkspaceForActor/);
  assert.match(service, /A user id on the write body is never the owner/);
});

test('10 Owner OFFICE manual key is the historical sentinel sheet', () => {
  const office = manualRowWorkspaceKeyForScope({
    scopeKind: 'OFFICE',
    workspaceSubjectUserId: OWNER,
  });
  assert.deepEqual(office, backfillExistingManualRowsToOfficeWorkspace());
  assert.equal(office.subject_user_id, CLIENT_OPERATIONS_MANUAL_OFFICE_SUBJECT_USER_ID);
});

test('11-12 Owner STAFF(A) and STAFF(B) resolve different member sheets', () => {
  const a = manualRowWorkspaceKeyForScope({ scopeKind: 'STAFF', workspaceSubjectUserId: STAFF_A });
  const b = manualRowWorkspaceKeyForScope({ scopeKind: 'STAFF', workspaceSubjectUserId: STAFF_B });
  const ownerMy = manualRowWorkspaceKeyForScope({ scopeKind: 'MY', workspaceSubjectUserId: OWNER });
  assert.equal(manualRowsShareWorkspace(a, b), false);
  assert.equal(manualRowsShareWorkspace(a, ownerMy), false);
  assert.equal(manualRowsShareWorkspace(a, backfillExistingManualRowsToOfficeWorkspace()), false);
  assert.notEqual(manualWorkspaceCacheKey(a), manualWorkspaceCacheKey(b));
});

test('13 Owner edit records the owner as actor and the employee as subject', () => {
  const service = readRepo('apps/api/src/domains/client-operations/client-operations-manual-rows.service.ts');
  const write = service.slice(
    service.indexOf('export async function setClientOperationsManualRowCellValue'),
    service.lastIndexOf('export { isMeaningfulManualCellValue }'),
  );
  assert.match(write, /actorUserId: input\.ctx\.user\.id/);
  assert.match(write, /workspace_subject_user_id: workspace\.subject_user_id/);
  assert.doesNotMatch(write, /actorUserId: workspace\.subject_user_id/);
  assert.doesNotMatch(write, /impersonat/i);
});

test('14 STAFF workspace clients come from the employee Stage 5.1 ACL', () => {
  const workspace = readRepo('apps/api/src/domains/client-operations/client-operations-workspace.service.ts');
  const staff = workspace.slice(
    workspace.indexOf('STAFF — employee visibility ACL'),
    workspace.indexOf('const workspace: ClientOperationsWorkspaceResolution'),
  );
  assert.match(staff, /resolveOrganizationClientAccessScope\(/);
  assert.match(staff, /employeeScope\.authorized_client_ids/);
  assert.match(staff, /materializationKind = employeeScope\.kind/);
  assert.doesNotMatch(staff, /loadAssignedClientIdsForHandler/);
  assert.match(workspace, /Owner\/Admin MY remains a responsibility projection/);
  assert.match(workspace, /loadAssignedClientIdsForHandler/);
});

test('15 selected ACL with zero grants yields zero clients and five manual slots', () => {
  const scope = scopeForMemberClientPolicy({
    organizationId: 'org',
    viewerUserId: STAFF_A,
    roleCode: 'staff',
    accessMode: 'selected',
    grantedActiveClientIds: [],
  });
  assert.deepEqual(scope.authorized_client_ids, []);
  const rows = materializeClientOperationsManualRows({
    columnKeys: ['notes'],
    valuesBySlotColumn: new Map(),
  });
  assert.equal(rows.length, 5);
  const aggregate = readRepo('apps/api/src/domains/client-operations/client-operations.service.ts');
  const empty = aggregate.slice(
    aggregate.indexOf('assignedOnlyIds && assignedOnlyIds.length === 0'),
    aggregate.indexOf('let activeClientsQuery'),
  );
  assert.match(empty, /built_rows: \[\]/);
  assert.match(empty, /loadManualRowValuesBySlotColumnForRegistryAggregate/);
  assert.match(empty, /workspace: manualWorkspace/);
});

test('16 ALL ACL keeps future live clients by leaving the id list unrestricted', () => {
  const scope = scopeForMemberClientPolicy({
    organizationId: 'org',
    viewerUserId: STAFF_A,
    roleCode: 'staff',
    accessMode: 'all',
    grantedActiveClientIds: [],
  });
  assert.equal(scope.kind, 'MEMBER_ALL');
  assert.equal(scope.authorized_client_ids, null);
  const workspace = readRepo('apps/api/src/domains/client-operations/client-operations-workspace.service.ts');
  assert.match(
    workspace,
    /employeeScope\.authorized_client_ids === null \? null : \[\.\.\.employeeScope\.authorized_client_ids\]/,
  );
});

test('17 archived client rules stay on the employee scope kind', () => {
  const aggregate = readRepo('apps/api/src/domains/client-operations/client-operations.service.ts');
  assert.match(aggregate, /accessScope\.kind !== 'MEMBER_ALL'/);
  const workspace = readRepo('apps/api/src/domains/client-operations/client-operations-workspace.service.ts');
  assert.match(workspace, /materializationKind = employeeScope\.kind/);
});

test('18-20 carry-forward stays inside one sheet and never seeds members from OFFICE', () => {
  const copy = readRepo('apps/api/src/domains/client-operations/client-operations-user-period-data-copy.service.ts');
  assert.match(copy, /resolveManualRowWorkspaceForActor/);
  assert.match(copy, /workspace: manualWorkspace/);
  const sql = readRepo('supabase/migrations/185_client_operations_manual_row_workspace.sql');
  assert.match(sql, /v\.workspace_kind = 'office'/);
  assert.match(sql, /v\.subject_user_id = v_office/);
  const copySql = sql.slice(sql.indexOf('v_prev :='), sql.indexOf('return true;'));
  assert.doesNotMatch(copySql, /workspace_kind = 'member'/);
  const a = manualRowWorkspaceKeyForScope({ scopeKind: 'MY', workspaceSubjectUserId: STAFF_A });
  const carried = planManualRowCarryForward({
    previousValues: [{ slot: 1, column_key: 'notes', value_text: 'keep-a' }],
  });
  assert.equal(carried.length, 1);
  assert.equal(manualRowsShareWorkspace(a, a), true);
  assert.equal(
    manualRowsShareWorkspace(a, backfillExistingManualRowsToOfficeWorkspace()),
    false,
  );
});

test('21-22 cross-organization and revoked subjects are not selectable STAFF subjects', () => {
  const workspace = readRepo('apps/api/src/domains/client-operations/client-operations-workspace.service.ts');
  assert.match(workspace, /\.eq\('organization_id', organizationId\)/);
  assert.match(workspace, /\.eq\('status', 'active'\)/);
  assert.match(workspace, /WORKSPACE_SUBJECT_FORBIDDEN/);
  const sql = readRepo('supabase/migrations/185_client_operations_manual_row_workspace.sql');
  assert.match(sql, /m\.status = 'active'/);
  assert.match(sql, /MANUAL_WORKSPACE_SUBJECT_FORBIDDEN/);
  assert.match(sql, /m\.organization_id = new\.organization_id/);
});

test('cache key separates an OFFICE sheet from a member sheet with the same client scope', () => {
  const filters = normalizeClientOperationsRegistryBusinessFilterQuery({});
  const base = {
    organizationId: 'org',
    accessScopeKey: 'OFFICE',
    selectedPeriodKey: '2026-09',
    defaultPeriodKey: '2026-09',
    canEditRegistry: true,
    filters,
  };
  const office = buildClientOperationsRegistryMaterializationCacheKey({
    ...base,
    manualWorkspaceKey: manualWorkspaceCacheKey(backfillExistingManualRowsToOfficeWorkspace()),
  });
  const member = buildClientOperationsRegistryMaterializationCacheKey({
    ...base,
    manualWorkspaceKey: manualWorkspaceCacheKey(
      manualRowWorkspaceKeyForScope({ scopeKind: 'STAFF', workspaceSubjectUserId: STAFF_A }),
    ),
  });
  assert.notEqual(office, member);
});
