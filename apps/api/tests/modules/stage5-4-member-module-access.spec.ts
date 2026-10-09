/**
 * Stage 5.4 — per-member module access.
 * Pure rules and source contracts. No live Supabase env.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  permissionGrantsModule,
  rolePermissionsGrantModule,
  STAGE54_ROLE_MODULE_CODES,
} from '../../src/domains/modules/member-module-access.pure.js';
import { restrictClientScopedRows } from '../../src/domains/client-operations/organization-client-access.pure.js';
import { resolveSessionNavigation } from '../../src/domains/auth/session-shell.pure.js';
import { workerMayOpenPath } from '../../../web/src/components/guards/worker-route.pure.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

const migration = readRepo('supabase/migrations/186_organization_member_module_access.sql');
const gate = readRepo('apps/api/src/middleware/requireModuleActive.ts');
const authRoutes = readRepo('apps/api/src/domains/auth/auth.routes.ts');
const modulesState = readRepo('apps/api/src/domains/modules/modules-state.service.ts');
const memberRoutes = readRepo('apps/api/src/domains/memberships/memberships.routes.ts');
const appShell = readRepo('apps/web/src/components/layout/AppShell.tsx');
const documents = readRepo('apps/api/src/domains/documents/documents.service.ts');
const upload = readRepo('apps/api/src/domains/documents/document-upload.service.ts');
const versions = readRepo('apps/api/src/domains/documents/document-versions.service.ts');
const docflowRoutes = readRepo('apps/api/src/routes/docflow.routes.ts');
const coRoutes = readRepo('apps/api/src/domains/client-operations/client-operations.routes.ts');

const staffPerms = [
  'client_operations.view',
  'client_operations.edit',
  'income.view',
  'income.edit',
  'income.issue',
  'income.issue_on_behalf',
  'docflow.review',
  'docflow:system_message_write',
  'work_engine.view',
  'work_engine.write',
];
const viewerPerms = ['client_operations.view', 'income.view', 'work_engine.view'];

test('role permission mapping matches current Staff and Viewer module entry', () => {
  for (const code of STAGE54_ROLE_MODULE_CODES.staff) {
    assert.equal(rolePermissionsGrantModule(staffPerms, code), true, code);
  }
  for (const code of STAGE54_ROLE_MODULE_CODES.viewer) {
    assert.equal(rolePermissionsGrantModule(viewerPerms, code), true, code);
  }
  assert.equal(rolePermissionsGrantModule(viewerPerms, 'docflow'), false);
  assert.equal(permissionGrantsModule('income.view', 'invoice'), true);
  assert.equal(permissionGrantsModule('income.view', 'income'), true);
  assert.equal(permissionGrantsModule('client_operations.view', 'invoice'), false);
});

test('backfill grants only active entitled modules the role can enter', () => {
  const backfill = migration.slice(
    migration.indexOf('-- BACKFILL START'),
    migration.indexOf('-- BACKFILL END'),
  );
  assert.match(backfill, /m\.role_code in \('staff', 'viewer'\)/);
  assert.match(backfill, /m\.status = 'active'/);
  assert.match(backfill, /organization_module_is_effectively_entitled/);
  assert.match(backfill, /role_permission_grants_module/);
  assert.match(backfill, /on conflict \(organization_id, membership_id, module_id\) do nothing/);
  assert.doesNotMatch(backfill, /'owner'/);
  assert.doesNotMatch(backfill, /'admin'/);
  assert.doesNotMatch(migration, /create trigger[\s\S]{0,180}on public\.organization_modules/i);
});

test('set_member_module_access is owner/admin, same org, entitled modules only', () => {
  assert.match(migration, /v_actor_role not in \('owner', 'admin'\)/);
  assert.match(migration, /MEMBER_MODULE_ACCESS_CROSS_ORG_MEMBER/);
  assert.match(migration, /MEMBER_MODULE_ACCESS_TARGET_ROLE/);
  assert.match(migration, /MEMBER_MODULE_ACCESS_UNKNOWN_MODULE/);
  assert.match(migration, /MEMBER_MODULE_ACCESS_UNENTITLED/);
  assert.match(migration, /member_module_access\.set/);
  assert.match(migration, /old_enabled_module_ids/);
  assert.match(migration, /new_enabled_module_ids/);
  assert.doesNotMatch(migration, /price_amount/);
  assert.match(memberRoutes, /set_member_module_access/);
  assert.match(memberRoutes, /withSetModuleAccess/);
  assert.match(memberRoutes, /requireOfficeAdministration/);
  assert.match(memberRoutes, /requirePermission\('members:write'\)|members:write/);
});

test('canonical module gate requires a Staff/Viewer grant after entitlement', () => {
  assert.match(gate, /assertStaffViewerMayUseModule/);
  const entitlement = gate.indexOf('entitlement.status !== \'entitled\'');
  const grant = gate.indexOf('await assertStaffViewerMayUseModule');
  assert.equal(entitlement > 0 && grant > entitlement, true);
  const service = readRepo('apps/api/src/domains/modules/member-module-access.service.ts');
  assert.match(service, /roleHasOfficeClientAccess/);
  assert.match(service, /status', 'active'/);
  assert.match(service, /enabled', true/);
  assert.match(service, /MEMBER_MODULE_ACCESS_DENIED/);
});

test('session available_modules is entitled modules intersected with member grants', () => {
  assert.match(authRoutes, /loadEnabledMemberModuleIdSet/);
  assert.match(authRoutes, /memberModuleIds\.has\(m\.moduleId\)/);
  assert.match(authRoutes, /grantedCodes/);
  assert.match(modulesState, /grantedIds\.has\(item\.moduleId\)/);
  const shell = resolveSessionNavigation({
    roleCode: 'staff',
    membershipActive: true,
    permissions: ['client_operations.view'],
    allCoreNavItems: [{ path: '/modules', label: 'Modules', order: 30 }],
    moduleAppNavItems: [{ path: '/m/income', label: 'Income', order: 40 }],
    commercialModuleCodes: ['invoice'],
    incomeOnboardingComplete: true,
  });
  assert.equal(shell.shell_profile, 'worker');
  assert.ok(shell.available_modules.some((item) => item.path === '/m/income'));
  assert.equal(
    workerMayOpenPath({
      shellProfile: shell.shell_profile,
      pathname: '/m/income',
      availableNavigation: shell.available_navigation,
    }),
    true,
  );
  assert.equal(
    workerMayOpenPath({
      shellProfile: shell.shell_profile,
      pathname: '/m/docflow',
      availableNavigation: shell.available_navigation,
    }),
    false,
  );
});

test('DocFlow widget mounts only from available_modules and the API still checks the grant', () => {
  assert.match(appShell, /available_modules\.some/);
  assert.match(appShell, /\/m\/docflow/);
  assert.match(appShell, /docflowWidgetAllowed \? <DocflowFloatingWidget \/> : null/);
  assert.match(docflowRoutes, /assertStaffViewerMayUseEntitledModuleCode\(ctx, 'docflow'\)/);
});

test('client-scoped module rows and client-owned documents use the Stage 5.1 allow-list', () => {
  const rows = [
    { id: 'c1', name: 'One' },
    { id: 'c3', name: 'Three' },
  ];
  assert.deepEqual(
    restrictClientScopedRows(rows, (row) => row.id, ['c1', 'c2']).map((row) => row.id),
    ['c1'],
  );
  assert.deepEqual(
    restrictClientScopedRows(rows, (row) => row.id, []).map((row) => row.id),
    [],
  );
  assert.equal(restrictClientScopedRows(rows, (row) => row.id, null).length, 2);
  assert.match(documents, /assertCanAccessClientFromContext/);
  assert.match(upload, /assertCanAccessClientFromContext/);
  // Stage 5.5: versions use the shared document guard, Income/WE routes the shared resource guard.
  assert.match(versions, /assertDocumentClientAccess/);
  assert.match(coRoutes, /requireModuleActive\(MODULE_CODE\)/);
  assert.match(readRepo('apps/api/src/domains/income/income.routes.ts'), /assertIncomeRequestClientAccess/);
  assert.match(readRepo('apps/api/src/domains/work-engine/work-engine.routes.ts'), /assertIncomeRequestClientAccess/);
});

test('migration is service-role only and does not touch endpoints.ts', () => {
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all on table public\.organization_member_module_access from anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete on table public\.organization_member_module_access to service_role/);
  assert.doesNotMatch(readRepo('apps/web/src/api/endpoints.ts'), /set_member_module_access/);
});
