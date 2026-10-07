/**
 * Stage 4 — Owner workspace scopes (MY / OFFICE / STAFF) without impersonation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMyWorkspaceOption,
  buildOfficeWorkspaceOption,
  buildStaffWorkspaceOption,
  canInspectOrganizationWorkspaces,
  defaultWorkspaceScopeKind,
  normalizeRequestedWorkspaceScopeKind,
  roleIsSelectableWorkspaceSubject,
  workspaceProjectionAccessScopeKey,
} from '../../src/domains/client-operations/client-operations-workspace.pure.js';
import {
  buildClientOperationsRegistryMaterializationCacheKey,
  clearClientOperationsRegistryMaterializationCacheForTests,
  clientOperationsRegistryMaterializationCache,
} from '../../src/domains/client-operations/client-operations-registry-materialization-cache.js';
import { normalizeClientOperationsRegistryBusinessFilterQuery } from '../../src/domains/client-operations/client-operations-registry-filters.pure.js';
import { roleHasOfficeClientAccess } from '../../src/domains/client-operations/organization-client-access.pure.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(__dirname, '../../src');

function readSrc(...parts: string[]): string {
  return readFileSync(join(srcRoot, ...parts), 'utf8');
}

test('A/B — Owner and Admin default workspace is OFFICE', () => {
  assert.equal(defaultWorkspaceScopeKind('owner'), 'OFFICE');
  assert.equal(defaultWorkspaceScopeKind('admin'), 'OFFICE');
  assert.equal(canInspectOrganizationWorkspaces('owner'), true);
  assert.equal(canInspectOrganizationWorkspaces('admin'), true);
  // RBAC decision: reuse Stage 3 office-access roles (owner+admin), not a new permission string.
  assert.equal(roleHasOfficeClientAccess('owner'), true);
  assert.equal(roleHasOfficeClientAccess('admin'), true);
});

test('C/D — Staff and Viewer default workspace is MY (fail-closed)', () => {
  assert.equal(defaultWorkspaceScopeKind('staff'), 'MY');
  assert.equal(defaultWorkspaceScopeKind('viewer'), 'MY');
  assert.equal(canInspectOrganizationWorkspaces('staff'), false);
  assert.equal(canInspectOrganizationWorkspaces('viewer'), false);
});

test('normalizeRequestedWorkspaceScopeKind accepts office/my/staff only', () => {
  assert.equal(normalizeRequestedWorkspaceScopeKind('office'), 'OFFICE');
  assert.equal(normalizeRequestedWorkspaceScopeKind('MY'), 'MY');
  assert.equal(normalizeRequestedWorkspaceScopeKind('staff'), 'STAFF');
  assert.equal(normalizeRequestedWorkspaceScopeKind('STAFF:anna'), null);
  assert.equal(normalizeRequestedWorkspaceScopeKind(''), null);
});

test('O — revoked / viewer not selectable as STAFF subject role', () => {
  assert.equal(roleIsSelectableWorkspaceSubject('staff'), true);
  assert.equal(roleIsSelectableWorkspaceSubject('admin'), true);
  assert.equal(roleIsSelectableWorkspaceSubject('owner'), false);
  assert.equal(roleIsSelectableWorkspaceSubject('viewer'), false);
  assert.equal(roleIsSelectableWorkspaceSubject('revoked'), false);
});

test('Hebrew labels for OFFICE / MY; staff uses display name', () => {
  assert.equal(buildOfficeWorkspaceOption().label_he, 'כל המשרד');
  assert.equal(buildMyWorkspaceOption().label_he, 'הלקוחות שלי');
  assert.equal(
    buildStaffWorkspaceOption({ userId: 'u-a', displayName: 'Anna', roleCode: 'staff' }).label_he,
    'Anna',
  );
});

test('V/W — cache keys isolate OFFICE vs Owner-MY vs Anna vs Dana; edit capability separate', async () => {
  clearClientOperationsRegistryMaterializationCacheForTests();
  const filters = normalizeClientOperationsRegistryBusinessFilterQuery({});
  const base = {
    organizationId: 'org-X',
    selectedPeriodKey: '2026-09',
    defaultPeriodKey: '2026-09',
    filters,
  };
  const office = buildClientOperationsRegistryMaterializationCacheKey({
    ...base,
    accessScopeKey: workspaceProjectionAccessScopeKey({ scopeKind: 'OFFICE', workspaceSubjectUserId: null }),
    canEditRegistry: true,
  });
  const ownerMy = buildClientOperationsRegistryMaterializationCacheKey({
    ...base,
    accessScopeKey: workspaceProjectionAccessScopeKey({
      scopeKind: 'MY',
      workspaceSubjectUserId: 'marina',
    }),
    canEditRegistry: true,
  });
  const anna = buildClientOperationsRegistryMaterializationCacheKey({
    ...base,
    accessScopeKey: workspaceProjectionAccessScopeKey({
      scopeKind: 'STAFF',
      workspaceSubjectUserId: 'anna',
    }),
    canEditRegistry: true,
  });
  const dana = buildClientOperationsRegistryMaterializationCacheKey({
    ...base,
    accessScopeKey: workspaceProjectionAccessScopeKey({
      scopeKind: 'STAFF',
      workspaceSubjectUserId: 'dana',
    }),
    canEditRegistry: true,
  });
  const annaViewOnly = buildClientOperationsRegistryMaterializationCacheKey({
    ...base,
    accessScopeKey: workspaceProjectionAccessScopeKey({
      scopeKind: 'STAFF',
      workspaceSubjectUserId: 'anna',
    }),
    canEditRegistry: false,
  });

  assert.equal(office.includes('OFFICE'), true);
  assert.notEqual(office, ownerMy);
  assert.notEqual(anna, dana);
  assert.notEqual(office, anna);
  assert.notEqual(anna, annaViewOnly); // X — viewer action dimension isolated

  let annaBuilds = 0;
  const annaMat = { tag: 'anna', built_rows: [{ client_id: 'c-anna' }], editable: true } as never;
  const hit1 = await clientOperationsRegistryMaterializationCache.getOrBuild(anna, async () => {
    annaBuilds += 1;
    return annaMat;
  });
  const hit2 = await clientOperationsRegistryMaterializationCache.getOrBuild(anna, async () => {
    annaBuilds += 1;
    return annaMat;
  });
  assert.equal(annaBuilds, 1);
  assert.equal((hit1.value as { tag: string }).tag, 'anna');
  assert.equal((hit2.value as { tag: string }).tag, 'anna');

  // Dana must not receive Anna materialization.
  const danaHit = await clientOperationsRegistryMaterializationCache.getOrBuild(dana, async () => ({
    tag: 'dana',
    built_rows: [{ client_id: 'c-dana' }],
  }) as never);
  assert.equal((danaHit.value as { tag: string }).tag, 'dana');

  // Owner OFFICE must not collide with Owner MY.
  const officeHit = await clientOperationsRegistryMaterializationCache.getOrBuild(office, async () => ({
    tag: 'office',
    built_rows: [{ client_id: 'all' }],
  }) as never);
  assert.equal((officeHit.value as { tag: string }).tag, 'office');

  clearClientOperationsRegistryMaterializationCacheForTests();
});

test('Stage4 source contracts — resolver, aggregate, routes, no impersonation, audit actor', () => {
  const pure = readSrc('domains/client-operations/client-operations-workspace.pure.ts');
  assert.match(pure, /canInspectOrganizationWorkspaces/);
  assert.match(pure, /defaultWorkspaceScopeKind/);
  assert.match(pure, /workspaceProjectionAccessScopeKey/);

  const workspaceSvc = readSrc('domains/client-operations/client-operations-workspace.service.ts');
  assert.match(workspaceSvc, /resolveClientOperationsWorkspaceScope/);
  assert.match(workspaceSvc, /WORKSPACE_SCOPE_FORBIDDEN/);
  assert.match(workspaceSvc, /WORKSPACE_SUBJECT_FORBIDDEN/);
  assert.match(workspaceSvc, /organization_memberships/);
  assert.match(workspaceSvc, /workspaceAggregateContract/);
  assert.match(workspaceSvc, /viewer_user_id/);
  assert.match(workspaceSvc, /workspace_subject_user_id/);
  // No impersonation: never mutate auth / session user.
  assert.doesNotMatch(workspaceSvc, /impersonat/i);
  assert.doesNotMatch(workspaceSvc, /ctx\.user\s*=/);

  const service = readSrc('domains/client-operations/client-operations.service.ts');
  assert.match(service, /resolveClientOperationsWorkspaceScopeFromContext/);
  assert.match(service, /workspaceAggregateContract/);
  assert.match(service, /accessScopeKey: materializationAccess\.access_scope_key/);
  assert.match(service, /actorUserId: ctx\.user\.id/);

  const routes = readSrc('domains/client-operations/client-operations.routes.ts');
  assert.match(routes, /workspace_scope/);
  assert.match(routes, /workspace_subject_user_id/);

  const presentation = readSrc('domains/client-operations/client-operations-registry-presentation.pure.ts');
  assert.match(presentation, /workspace_scope/);
  assert.match(presentation, /workspace_subject_user_id/);
});

test('Stage4 live DB A–AB', async (t) => {
  const configured = Boolean(
    process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
  if (!configured) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }
  t.skip('Live A–AB reserved for applied DB environment');
});
