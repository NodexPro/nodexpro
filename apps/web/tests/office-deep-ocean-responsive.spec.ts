/**
 * Deep Ocean V3 office controls, Register restyle, Dashboard period chips,
 * Users & Roles cyan labels, and responsive shell — presentation only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

const oceanCss = read('../src/styles/nx-office-deep-ocean.css');
const createOceanCss = read('../src/styles/nx-client-create-deep-ocean-glass.css');
const dashboardCss = read('../src/styles/nx-dashboard.css');
const dashboardSrc = read('../src/pages/Dashboard.tsx');
const usersRolesSrc = read('../src/pages/UsersRoles.tsx');
const usersRolesCss = read('../src/components/users-roles/UsersRoles.css');
const registerSrc = read('../src/pages/Register.tsx');
const billingSrc = read('../src/pages/Billing.tsx');
const settingsSrc = read('../src/pages/Settings.tsx');
const clientsSrc = read('../src/pages/Clients.tsx');
const documentsSrc = read('../src/pages/Documents.tsx');
const modulesSrc = read('../src/pages/Modules.tsx');
const shellCss = read('../src/styles/nx-client-operations-shell.css');
const sidebarSrc = read('../src/templates/template-1/components/AppSidebar.tsx');
const sidebarCss = read('../src/templates/template-1/t1-sidebar-account.css');

test('shared office Deep Ocean V3 reuses Create Client tokens and stays scoped', () => {
  assert.match(oceanCss, /\.nx-office-ocean/);
  assert.match(oceanCss, /#102[Dd]49/);
  assert.match(oceanCss, /#13[Bb][Ff][Dd]0|#36[Aa]9[Cc]6|rgba\(19, 191, 208/);
  assert.match(oceanCss, /\.nx-office-ocean \.nx-glass-btn--purple/);
  assert.match(oceanCss, /rgba\(19, 191, 208, 0\.78\)/);
  assert.match(oceanCss, /\.nx-office-ocean \.nx-glass-input::placeholder/);
  assert.match(oceanCss, /color: rgba\(255, 255, 255, 0\.86\)/);
  assert.match(oceanCss, /\.nx-office-ocean \.nx-glass-input option \{[\s\S]*background:\s*#102d49/);
  assert.doesNotMatch(oceanCss, /\.nx-modules/);
  assert.doesNotMatch(oceanCss, /(?:^|\n)\.nx-glass-btn--purple\s*\{/);
  assert.match(createOceanCss, /rgba\(19, 191, 208, 0\.78\)/);
});

test('office pages opt into Deep Ocean V3; Modules commercial cards do not', () => {
  assert.match(billingSrc, /nx-office-ocean/);
  assert.match(settingsSrc, /nx-office-ocean/);
  assert.match(clientsSrc, /nx-office-ocean/);
  assert.match(documentsSrc, /nx-office-ocean/);
  assert.match(usersRolesSrc, /nx-ur-page nx-office-ocean/);
  assert.match(registerSrc, /nx-office-ocean nx-register-ocean/);
  assert.doesNotMatch(modulesSrc, /nx-office-ocean/);
  assert.match(modulesSrc, /nx-modules--deep-ocean/);
  assert.doesNotMatch(dashboardSrc, /nx-office-ocean/);
});

test('Dashboard period chips use Deep Ocean V3 without changing period commands', () => {
  assert.match(dashboardSrc, /office\.period\.options\.map/);
  assert.match(dashboardSrc, /setPeriod\(opt\.key\)/);
  assert.match(dashboardSrc, /<UiLanguageSwitch compact \/>/);
  assert.match(dashboardCss, /\.nx-dashboard-period__chip \{[\s\S]*color:\s*#ffffff/);
  assert.match(dashboardCss, /\.nx-dashboard-period__chip\.is-selected \{[\s\S]*rgba\(19, 191, 208, 0\.78\)/);
  assert.match(dashboardCss, /\.nx-dashboard-period__chip:focus-visible/);
  assert.doesNotMatch(dashboardCss, /\.nx-dashboard-period__chip\.is-selected \{[\s\S]*rgba\(39, 124, 255/);
});

test('Users & Roles Owner/Active labels use cyan and keep aggregate role truth', () => {
  assert.match(usersRolesSrc, /fetchUsersRolesAggregate/);
  assert.match(usersRolesSrc, /o\.membership\.status\.label/);
  assert.match(usersRolesSrc, /m\.membership\.status\.code/);
  assert.match(usersRolesCss, /\.nx-ur-owner__tag,[\s\S]*color:\s*#7decf7/);
  assert.match(usersRolesCss, /\.nx-ur-you \{[\s\S]*rgba\(19, 191, 208, 0\.28\)/);
  assert.match(usersRolesCss, /\.nx-ur-modal \.nx-btn\.nx-btn-primary \{[\s\S]*rgba\(19, 191, 208, 0\.78\)/);
  assert.doesNotMatch(usersRolesCss, /#6657e8|rgba\(128, 116, 242/);
  assert.doesNotMatch(usersRolesSrc, /statusToUi|TABLE_COLUMNS\.match/);
});

test('Register keeps the existing auth protocol and gains Deep Ocean V3 presentation', () => {
  assert.match(registerSrc, /AUTH\.register/);
  assert.match(registerSrc, /signInWithPassword/);
  assert.match(registerSrc, /resolvePostRegisterDestination/);
  assert.match(registerSrc, /dir=\{dir\}/);
  assert.match(registerSrc, /lang=\{lang\}/);
  assert.match(registerSrc, /inputMode="email"/);
  assert.match(registerSrc, /placeholder=\{t\('auth\.email'\)\}/);
  assert.match(registerSrc, /nx-glass-btn--purple/);
  assert.match(oceanCss, /\.nx-register-ocean \.nx-glass-auth__card/);
  assert.match(oceanCss, /backdrop-filter:\s*blur\(22px\)/);
  assert.doesNotMatch(registerSrc, /AppSidebar|TemplateLayout/);
  assert.doesNotMatch(registerSrc, /method: 'PATCH'/);
});

test('responsive office shell keeps tables scrollable and avoids page overflow', () => {
  assert.match(oceanCss, /@media \(max-width: 430px\)/);
  assert.match(oceanCss, /@media \(max-width: 768px\)/);
  assert.match(dashboardCss, /@media \(max-width: 430px\)/);
  assert.match(shellCss, /height:\s*100dvh/);
  assert.match(shellCss, /overflow-x:\s*hidden/);
  assert.match(shellCss, /@media \(max-width: 768px\)[\s\S]*padding:\s*12px 12px 18px/);
  assert.match(sidebarCss, /height:\s*100dvh/);
  assert.match(sidebarSrc, /coarsePointer/);
  assert.match(sidebarSrc, /t1-sidebar__brand-toggle/);
  assert.match(usersRolesCss, /\.nx-ur-page__head \{[\s\S]*flex-wrap:\s*wrap/);
  assert.match(usersRolesCss, /\.nx-ur-table-scroll/);
});
