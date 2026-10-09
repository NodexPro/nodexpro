/**
 * Stage 5.3 — office administration is Owner/Admin, and navigation is backend-owned.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  officeAdminActionsForPermissions,
  resolveSessionNavigation,
} from '../../src/domains/auth/session-shell.pure.js';
import { workerMayOpenPath } from '../../../web/src/components/guards/worker-route.pure.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

const officePermissions = [
  'clients:write',
  'clients:archive',
  'clients:read',
  'settings:read',
  'members:read',
  'subscriptions:read',
  'modules:read',
  'modules:write',
  'documents:read',
];

const coreNav = [
  { path: '/dashboard', label: 'Dashboard', order: 0 },
  { path: '/settings', label: 'Settings', order: 10 },
  { path: '/users-roles', label: 'Users & Roles', order: 20 },
  { path: '/clients', label: 'Clients', order: 25 },
  { path: '/documents', label: 'Documents', order: 26 },
  { path: '/modules', label: 'Modules', order: 30 },
  { path: '/billing', label: 'Billing', order: 40 },
];

const moduleNav = [
  { path: '/m/client-operations', label: 'Nodex לקוחות', order: 60 },
];

function shellFor(role: string | null, active = true) {
  return resolveSessionNavigation({
    roleCode: role,
    membershipActive: active,
    permissions: officePermissions,
    allCoreNavItems: coreNav,
    moduleAppNavItems: moduleNav,
    commercialModuleCodes: ['client-operations', 'income'],
    incomeOnboardingComplete: true,
  });
}

test('1-12 Owner and Admin receive client-admin actions; Staff and Viewer do not', () => {
  const owner = shellFor('owner');
  const admin = shellFor('admin');
  for (const action of [
    'create_client',
    'import_clients',
    'preview_client_import',
    'archive_client',
    'restore_client',
    'mark_client_inactive',
    'reactivate_client',
  ]) {
    assert.ok(owner.available_actions.includes(action), action);
    assert.ok(admin.available_actions.includes(action), action);
    assert.equal(shellFor('staff').available_actions.includes(action), false);
    assert.equal(shellFor('viewer').available_actions.includes(action), false);
  }
  const clients = readRepo('apps/api/src/domains/clients/clients.service.ts');
  const imports = readRepo('apps/api/src/domains/clients/client-import-export.service.ts');
  const routes = readRepo('apps/api/src/domains/clients/clients.routes.ts');
  for (const name of ['createClient', 'archiveClient', 'restoreClient', 'bulkArchive', 'bulkRestore', 'bulkMarkInactive', 'bulkMarkActive', 'listClients']) {
    const start = clients.indexOf(`export async function ${name}`);
    const next = clients.indexOf('export async function', start + 10);
    const body = clients.slice(start, next === -1 ? undefined : next);
    assert.match(body, /assertOfficeAdministration/);
  }
  assert.match(imports.slice(imports.indexOf('function previewImport') === -1 ? imports.indexOf('export async function previewImport') : 0, imports.indexOf('export async function executeImport') + 400), /assertOfficeAdministration/);
  assert.match(imports, /export async function executeImport[\s\S]{0,220}assertOfficeAdministration/);
  for (const path of ['clients/import/preview', 'clients/import', "clients/:clientId/archive", "clients/:clientId/restore", 'bulk/archive', 'bulk/restore', 'bulk/mark-inactive']) {
    assert.match(routes, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "[\\s\\S]{0,180}requireOfficeAdministration"));
  }
});

test('13-20 Owner and Admin keep office navigation; Staff and Viewer get the worker shell', () => {
  for (const role of ['owner', 'admin'] as const) {
    const paths = shellFor(role).available_navigation.map((item) => item.path);
    assert.ok(paths.includes('/dashboard'));
    assert.ok(paths.includes('/settings'));
    assert.ok(paths.includes('/users-roles'));
    assert.ok(paths.includes('/billing'));
    assert.ok(paths.includes('/clients'));
    assert.equal(shellFor(role).shell_profile, 'full_platform');
  }
  for (const role of ['staff', 'viewer'] as const) {
    const shell = shellFor(role);
    const paths = shell.available_navigation.map((item) => item.path);
    assert.equal(shell.shell_profile, 'worker');
    assert.ok(paths.includes('/modules'));
    assert.ok(paths.includes('/m/client-operations'));
    for (const blocked of ['/dashboard', '/settings', '/users-roles', '/billing', '/clients', '/documents']) {
      assert.equal(paths.includes(blocked), false, `${role} ${blocked}`);
    }
    assert.deepEqual(shell.available_actions, []);
  }
});

test('21-27 direct office routes and office actions fail closed for a worker shell', () => {
  const staff = shellFor('staff');
  const viewer = shellFor('viewer');
  for (const shell of [staff, viewer]) {
    for (const path of ['/settings', '/users-roles', '/billing', '/clients', '/dashboard', '/documents']) {
      assert.equal(
        workerMayOpenPath({
          shellProfile: shell.shell_profile,
          pathname: path,
          availableNavigation: shell.available_navigation,
        }),
        false,
        path,
      );
    }
  }
  assert.equal(officeAdminActionsForPermissions(officePermissions).includes('create_client'), true);
  assert.deepEqual(shellFor('staff').available_actions, []);
  const clientsPage = readRepo('apps/web/src/pages/Clients.tsx');
  assert.match(clientsPage, /available_actions/);
  assert.match(clientsPage, /create_client/);
  assert.match(clientsPage, /import_clients/);
  assert.match(clientsPage, /archive_client/);
  assert.match(clientsPage, /restore_client/);
  assert.doesNotMatch(clientsPage, /permissions\?\.includes\('clients:write'\)/);
  assert.doesNotMatch(clientsPage, /permissions\?\.includes\('clients:archive'\)/);
});

test('28-32 worker may open an authorized client card and a granted module, and Owner shell is unchanged', () => {
  const staff = shellFor('staff');
  assert.equal(
    workerMayOpenPath({
      shellProfile: 'worker',
      pathname: '/clients/11111111-1111-4111-8111-111111111111',
      availableNavigation: staff.available_navigation,
    }),
    true,
  );
  assert.equal(
    workerMayOpenPath({
      shellProfile: 'worker',
      pathname: '/m/client-operations',
      availableNavigation: staff.available_navigation,
    }),
    true,
  );
  const manual = readRepo('apps/api/src/domains/client-operations/client-operations-manual-rows.service.ts');
  assert.match(manual, /resolveManualRowWorkspaceForActor/);
  const workspace = readRepo('apps/api/src/domains/client-operations/client-operations-workspace.service.ts');
  assert.match(workspace, /STAFF — employee visibility ACL/);
  const owner = shellFor('owner');
  assert.equal(owner.shell_profile, 'full_platform');
  assert.equal(owner.default_route, '/dashboard');
});

test('33-34 revoked membership and a missing navigation projection fail closed', () => {
  const revoked = shellFor('staff', false);
  assert.equal(revoked.shell_profile, 'closed');
  assert.deepEqual(revoked.available_navigation, []);
  assert.deepEqual(revoked.available_actions, []);
  const missing = shellFor('', true);
  assert.equal(missing.shell_profile, 'closed');
  assert.equal(
    workerMayOpenPath({
      shellProfile: 'worker',
      pathname: '/modules',
      availableNavigation: null,
    }),
    false,
  );
  assert.equal(
    workerMayOpenPath({
      shellProfile: 'closed',
      pathname: '/modules',
      availableNavigation: [{ path: '/modules' }],
    }),
    false,
  );
});

test('worker shell does not use a frontend role matrix', () => {
  const shell = readRepo('apps/web/src/components/layout/AppShell.tsx');
  assert.doesNotMatch(shell, /buildNavItemsFallback/);
  assert.doesNotMatch(shell, /role === ['"]staff['"]/);
  assert.doesNotMatch(shell, /role === ['"]viewer['"]/);
  assert.match(shell, /available_navigation/);
  const settings = readRepo('apps/api/src/domains/organization-settings/organization-settings.routes.ts');
  const members = readRepo('apps/api/src/domains/memberships/memberships.routes.ts');
  const billing = readRepo('apps/api/src/domains/subscriptions/subscriptions.routes.ts');
  const dashboard = readRepo('apps/api/src/domains/dashboard/dashboard.routes.ts');
  assert.match(settings, /requireOfficeAdministration/);
  assert.match(members, /requireOfficeAdministration/);
  assert.match(billing, /requireOfficeAdministration/);
  assert.match(dashboard, /requireOfficeAdministration/);
});
