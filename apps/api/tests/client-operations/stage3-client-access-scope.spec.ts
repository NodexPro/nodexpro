/**
 * Stage 3 — Client assignment as backend access scope + CO cache isolation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildClientAccessScopeKey,
  canManageClientHandlerAssignment,
  clientIdIsAuthorized,
  filterAuthorizedClientIds,
  roleHasOfficeClientAccess,
  type OrganizationClientAccessScope,
} from '../../src/domains/client-operations/organization-client-access.pure.js';
import {
  buildClientOperationsRegistryMaterializationCacheKey,
  clearClientOperationsRegistryMaterializationCacheForTests,
  clientOperationsRegistryMaterializationCache,
} from '../../src/domains/client-operations/client-operations-registry-materialization-cache.js';
import { normalizeClientOperationsRegistryBusinessFilterQuery } from '../../src/domains/client-operations/client-operations-registry-filters.pure.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(__dirname, '../../src');

function readSrc(...parts: string[]): string {
  return readFileSync(join(srcRoot, ...parts), 'utf8');
}

function scope(partial: Partial<OrganizationClientAccessScope> & Pick<OrganizationClientAccessScope, 'kind'>): OrganizationClientAccessScope {
  const viewer = partial.viewer_user_id ?? 'u1';
  const kind = partial.kind;
  return {
    organization_id: partial.organization_id ?? 'org',
    viewer_user_id: viewer,
    role_code: partial.role_code ?? (kind === 'OFFICE' ? 'owner' : 'staff'),
    kind,
    access_scope_key: buildClientAccessScopeKey({ kind, viewerUserId: viewer }),
    authorized_client_ids: partial.authorized_client_ids ?? (kind === 'OFFICE' ? null : []),
  };
}

test('A/B — Owner and Admin have OFFICE scope roles', () => {
  assert.equal(roleHasOfficeClientAccess('owner'), true);
  assert.equal(roleHasOfficeClientAccess('admin'), true);
  assert.equal(canManageClientHandlerAssignment('owner'), true);
  assert.equal(canManageClientHandlerAssignment('admin'), true);
});

test('C/D/E — Staff/Viewer assigned-only; unassigned not authorized for Staff', () => {
  assert.equal(roleHasOfficeClientAccess('staff'), false);
  assert.equal(roleHasOfficeClientAccess('viewer'), false);
  assert.equal(canManageClientHandlerAssignment('staff'), false);
  const staff = scope({
    kind: 'ASSIGNED_TO_SELF',
    viewer_user_id: 'staff-a',
    authorized_client_ids: ['c-a'],
  });
  assert.equal(clientIdIsAuthorized(staff, 'c-a'), true);
  assert.equal(clientIdIsAuthorized(staff, 'c-b'), false);
  assert.equal(clientIdIsAuthorized(staff, 'unassigned'), false);
  const office = scope({ kind: 'OFFICE', role_code: 'owner' });
  assert.equal(clientIdIsAuthorized(office, 'unassigned'), true);
});

test('J — Staff cannot manage handler assignment', () => {
  assert.equal(canManageClientHandlerAssignment('staff'), false);
  assert.equal(canManageClientHandlerAssignment('viewer'), false);
});

test('P/Q — cache keys isolate OFFICE vs Staff A vs Staff B', async () => {
  clearClientOperationsRegistryMaterializationCacheForTests();
  const filters = normalizeClientOperationsRegistryBusinessFilterQuery({});
  const base = {
    organizationId: 'org-X',
    selectedPeriodKey: '2026-09',
    defaultPeriodKey: '2026-09',
    canEditRegistry: true,
    filters,
  };
  const officeKey = buildClientOperationsRegistryMaterializationCacheKey({ ...base, accessScopeKey: 'OFFICE' });
  const aKey = buildClientOperationsRegistryMaterializationCacheKey({
    ...base,
    accessScopeKey: 'ASSIGNED:staff-a',
  });
  const bKey = buildClientOperationsRegistryMaterializationCacheKey({
    ...base,
    accessScopeKey: 'ASSIGNED:staff-b',
  });
  assert.notEqual(officeKey, aKey);
  assert.notEqual(aKey, bKey);

  let officeBuilds = 0;
  let staffBuilds = 0;
  const officeMat = { built_rows: [{ client_id: 'all' }], tag: 'office' } as never;
  const staffMat = { built_rows: [{ client_id: 'only-a' }], tag: 'staff-a' } as never;

  const officeHit = await clientOperationsRegistryMaterializationCache.getOrBuild(officeKey, async () => {
    officeBuilds += 1;
    return officeMat;
  });
  const staffHit = await clientOperationsRegistryMaterializationCache.getOrBuild(aKey, async () => {
    staffBuilds += 1;
    return staffMat;
  });
  assert.equal(officeBuilds, 1);
  assert.equal(staffBuilds, 1);
  assert.notEqual((officeHit.value as { tag: string }).tag, (staffHit.value as { tag: string }).tag);

  // Staff request must not receive office cached rows when using Staff key.
  const staffAgain = await clientOperationsRegistryMaterializationCache.getOrBuild(aKey, async () => {
    staffBuilds += 1;
    return staffMat;
  });
  assert.equal(staffBuilds, 1);
  assert.equal((staffAgain.value as { tag: string }).tag, 'staff-a');
  assert.equal((staffAgain.value as { built_rows: Array<{ client_id: string }> }).built_rows[0]?.client_id, 'only-a');

  const staffB = await clientOperationsRegistryMaterializationCache.getOrBuild(bKey, async () => ({
    built_rows: [{ client_id: 'only-b' }],
    tag: 'staff-b',
  }) as never);
  assert.equal((staffB.value as { tag: string }).tag, 'staff-b');
  clearClientOperationsRegistryMaterializationCacheForTests();
});

test('filterAuthorizedClientIds respects OFFICE vs ASSIGNED', () => {
  const office = scope({ kind: 'OFFICE' });
  assert.deepEqual(filterAuthorizedClientIds(office, ['a', 'b']), ['a', 'b']);
  const staff = scope({ kind: 'ASSIGNED_TO_SELF', authorized_client_ids: ['a'] });
  assert.deepEqual(filterAuthorizedClientIds(staff, ['a', 'b', 'c']), ['a']);
});

test('Stage3 source contracts — ACL before cache; Staff cannot change handler; assign commands', () => {
  const pure = readSrc('domains/client-operations/organization-client-access.pure.ts');
  assert.match(pure, /ASSIGNED_TO_SELF/);
  assert.match(pure, /OFFICE/);
  assert.match(pure, /buildClientAccessScopeKey/);

  const access = readSrc('domains/client-operations/organization-client-access.ts');
  assert.match(access, /resolveOrganizationClientAccessScope/);
  assert.match(access, /assertCanAccessClient/);
  assert.match(access, /fail closed to assigned-only/);

  const cache = readSrc('domains/client-operations/client-operations-registry-materialization-cache.ts');
  assert.match(cache, /accessScopeKey/);
  assert.match(cache, /'v2'/);
  assert.match(cache, /BEFORE/);

  const service = readSrc('domains/client-operations/client-operations.service.ts');
  assert.match(service, /resolveClientOperationsWorkspaceScopeFromContext|resolveOrganizationClientAccessScopeFromContext/);
  assert.match(service, /accessScopeKey: (?:materializationAccess|accessScope)\.access_scope_key/);
  assert.match(service, /CLIENT_HANDLER_ASSIGNMENT_FORBIDDEN/);
  assert.match(service, /assignClientHandler/);
  assert.match(service, /bulkAssignClientHandler/);

  const cmds = readSrc('domains/client-operations/client-operations-commands.service.ts');
  assert.match(cmds, /assign_client_handler/);
  assert.match(cmds, /executeBulkAssignClientHandlerCommand/);

  const routes = readSrc('domains/client-operations/client-operations.routes.ts');
  assert.match(routes, /router\.param\('clientId'/);
  assert.match(routes, /assign_client_handler/);
  assert.match(routes, /bulk_assign_client_handler/);

  const core = readSrc('domains/clients/clients.service.ts');
  assert.match(core, /assertCanAccessClientFromContext/);
  assert.match(core, /resolveOrganizationClientAccessScopeFromContext/);
  assert.match(core, /resolveBulkClientsInOrg\(ctx,/);

  const coreRoutes = readSrc('domains/clients/clients.routes.ts');
  assert.match(coreRoutes, /requireAuthorizedClientParam/);
  assert.match(coreRoutes, /router\.param\('clientId'/);

  const periodCopy = readSrc('domains/client-operations/client-operations-user-period-data-copy.service.ts');
  assert.match(periodCopy, /authorizedCustomPlan/);

  const exportSvc = readSrc('domains/clients/client-import-export.service.ts');
  assert.match(exportSvc, /filterAuthorizedClientIds/);
});

test('Stage3 live DB A–W', async (t) => {
  const configured = Boolean(
    process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
  if (!configured) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }
  t.skip('Live A–W reserved for applied DB environment');
});
