/**
 * Dashboard V2.4: unified header toolbar, navy-native glass scrollbars,
 * office Clients (/clients) and Roles (/users-roles) glass presentation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const dashSrc = readFileSync(join(dir, '../src/pages/Dashboard.tsx'), 'utf8');
const dashCss = readFileSync(join(dir, '../src/styles/nx-dashboard.css'), 'utf8');
const langSwitchSrc = readFileSync(join(dir, '../src/components/glass/UiLanguageSwitch.tsx'), 'utf8');
const glassCss = readFileSync(join(dir, '../src/styles/nx-glass-surface.css'), 'utf8');
const layoutSrc = readFileSync(join(dir, '../src/templates/template-1/TemplateLayout.tsx'), 'utf8');
const appSrc = readFileSync(join(dir, '../src/App.tsx'), 'utf8');
const clientsSrc = readFileSync(join(dir, '../src/pages/Clients.tsx'), 'utf8');
const clientCardSrc = readFileSync(join(dir, '../src/pages/ClientCard.tsx'), 'utf8');
const usersRolesSrc = readFileSync(join(dir, '../src/pages/UsersRoles.tsx'), 'utf8');
const usersRolesCss = readFileSync(join(dir, '../src/components/users-roles/UsersRoles.css'), 'utf8');
const clientsCss = readFileSync(join(dir, '../src/styles/nx-clients.css'), 'utf8');
const coSheetCss = readFileSync(join(dir, '../src/styles/nx-client-operations-spreadsheet.css'), 'utf8');
const shellCss = readFileSync(join(dir, '../src/styles/nx-client-operations-shell.css'), 'utf8');
const enI18n = readFileSync(join(dir, '../src/i18n/en.json'), 'utf8');
const heI18n = readFileSync(join(dir, '../src/i18n/he.json'), 'utf8');

test('office Clients and Roles routes are the existing office screens, not owner or CO', () => {
  assert.match(appSrc, /path="users-roles" element=\{<UsersRoles \/>\}/);
  assert.match(appSrc, /path="clients" element=\{<Clients \/>\}/);
  assert.match(appSrc, /path="clients\/:clientId" element=\{<ClientCard \/>\}/);
  assert.doesNotMatch(layoutSrc, /legal-control/);
  assert.match(layoutSrc, /pathname === '\/clients'/);
  assert.match(layoutSrc, /const isOfficeClients/);
});

test('Dashboard header is one horizontal toolbar with period then compact EN/עב', () => {
  assert.match(dashSrc, /data-testid="nx-dashboard-toolbar"/);
  assert.match(dashSrc, /<UiLanguageSwitch compact \/>/);
  assert.match(dashCss, /\.nx-dashboard__header-tools \{[^}]*flex-direction: row/);
  assert.doesNotMatch(dashCss, /\.nx-dashboard__header-tools \{[^}]*flex-direction: column/);
  assert.match(langSwitchSrc, /compact \? t\('dashboard\.lang\.enCompact'\)/);
  assert.match(langSwitchSrc, /auth\.setUiLanguage\(code\)/);
  assert.match(enI18n, /"enCompact": "EN"/);
  assert.match(heI18n, /"heCompact": "עב"/);
  assert.match(glassCss, /\.nx-glass-lang__btn\.is-selected \{[\s\S]*rgba\(128, 116, 242/);
});

test('period selection and dashboard sections stay on the existing aggregate', () => {
  assert.match(dashSrc, /onClick=\{\(\) => setPeriod\(opt\.key\)\}/);
  assert.match(dashSrc, /office\.missing_fees/);
  assert.match(dashSrc, /office\.attention/);
  assert.match(dashSrc, /office\.deadlines/);
  assert.match(dashSrc, /office\.charts\.client_growth/);
  assert.match(dashSrc, /office\.client_status/);
  assert.match(dashSrc, /office\.charts\.expected_fees_by_month/);
  assert.match(dashSrc, /office\.quick_actions/);
  assert.match(dashSrc, /office\.recent_activity/);
  assert.match(dashSrc, /nx-dashboard__row--triple/);
});

test('navy-native scrollbars are transparent cyan, not a global html override', () => {
  assert.match(glassCss, /--nx-glass-scroll-track: transparent/);
  assert.match(glassCss, /--nx-glass-scroll-thumb: rgba\(125, 236, 247/);
  assert.match(
    glassCss,
    /\.t1-appShell--client-operations:not\(\.t1-appShell--general\) \.t1-shellColumn/,
  );
  assert.doesNotMatch(glassCss, /(?:^|[\s,{])(?:html|body|\*)::-webkit-scrollbar/);
  assert.match(coSheetCss, /scrollbar-color: var\(--nx-glass-scroll-thumb/);
  assert.match(coSheetCss, /\.nx-co-sheet__canvas::-webkit-scrollbar-track \{[\s\S]*background: transparent/);
  assert.match(shellCss, /:has\(\.nx-co-sheet\) \.t1-shellColumn \{[\s\S]*overflow: hidden/);
});

test('office Clients list uses shared glass tokens without rewriting writes or RBAC', () => {
  assert.match(clientsSrc, /nx-glass-page nx-glass-page--wide nx-clients/);
  assert.match(clientsSrc, /nx-glass-btn--purple/);
  assert.match(clientsSrc, /t\('clients\.title'\)/);
  assert.match(clientsSrc, /create_client/);
  assert.match(clientsSrc, /method: 'POST'/);
  assert.match(clientsSrc, /orgClients\(orgId\)/);
  assert.doesNotMatch(clientsSrc, /method: 'PATCH'/);
  assert.match(clientsCss, /\.nx-clients-table/);
});

test('Roles page keeps aggregate commands and gains dashboard glass, not a light sheet', () => {
  assert.match(usersRolesSrc, /fetchUsersRolesAggregate/);
  assert.match(usersRolesSrc, /available_actions\.invite_member/);
  assert.match(usersRolesSrc, /uiText\(ui, key\)/);
  assert.match(usersRolesCss, /rgba\(128, 116, 242, 0\.42\)/);
  assert.match(usersRolesCss, /backdrop-filter: blur\(12px\)/);
  assert.doesNotMatch(usersRolesCss, /\.nx-ur-sheet \{[\s\S]*rgba\(247, 250, 255, 0\.97\)/);
  assert.doesNotMatch(usersRolesCss, /linear-gradient\(135deg, #1477e8, #00cfef\)/);
});

test('Client details stays on the office /clients/:id contract', () => {
  assert.match(clientCardSrc, /nx-clients-card/);
  assert.match(clientCardSrc, /navigate\('\/clients'\)/);
  assert.match(clientCardSrc, /orgClientFull/);
});
