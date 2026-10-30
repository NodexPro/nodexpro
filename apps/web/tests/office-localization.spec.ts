/**
 * Shared office language: session preference → I18nProvider + Users & Roles aggregate.
 * Covers Clients / Users & Roles direction, switcher location, identifier LTR, and EN/HE keys.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');
const en = JSON.parse(read('../src/i18n/en.json')) as Record<string, unknown>;
const he = JSON.parse(read('../src/i18n/he.json')) as Record<string, unknown>;

function flatten(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flatten(value, prefix ? `${prefix}.${key}` : key),
  );
}

test('5-6. one shared switcher writes the language command and applies the returned session', () => {
  const switcher = read('../src/components/glass/UiLanguageSwitch.tsx');
  const auth = read('../src/contexts/AuthContext.tsx');
  const i18n = read('../src/i18n/I18nProvider.tsx');
  const shell = read('../src/components/layout/AppShell.tsx');
  const sidebar = read('../src/templates/template-1/components/SidebarAccountBlock.tsx');
  const header = read('../src/templates/template-1/components/AppHeader.tsx');
  assert.match(switcher, /auth\.setUiLanguage\(code\)/);
  assert.match(switcher, /refreshed\?\.sidebar_account_block\.language_selector\.current_value/);
  assert.doesNotMatch(switcher, /select\('ru'\)/);
  assert.doesNotMatch(switcher, /dashboard\.lang\.ruCompact/);
  assert.match(auth, /AUTH\.setUiLanguageCommand/);
  assert.doesNotMatch(auth.slice(auth.indexOf('const setUiLanguage'), auth.indexOf('const signOut')), /refetchMe|AUTH\.session|\/auth\/session/);
  assert.match(i18n, /document\.documentElement\.lang = lang/);
  assert.match(i18n, /document\.documentElement\.dir = lang === 'he' \? 'rtl' : 'ltr'/);
  assert.match(shell, /SessionLanguageSync/);
  assert.doesNotMatch(sidebar, /UiLanguageSwitch/);
  assert.match(read('../src/pages/Dashboard.tsx'), /<UiLanguageSwitch compact \/>/);
  assert.doesNotMatch(header, /t\('topBar\.language'\)/);
});

test('7-10. Clients and Users & Roles consume the same session language and follow dir', () => {
  const clients = read('../src/pages/Clients.tsx');
  const users = read('../src/pages/UsersRoles.tsx');
  assert.match(clients, /const \{ t, lang \} = useI18n\(\)/);
  assert.match(clients, /dir=\{dir\} lang=\{lang\}/);
  assert.match(clients, /dir=\{lang === 'he' \? 'rtl' : 'ltr'\}/);
  assert.match(clients, /t\('clients\.create\.title'\)/);
  assert.match(users, /auth\.me\.localization\?\.language\.current/);
  assert.match(users, /\[load, sessionLang\]/);
  assert.match(users, /dir=\{ui\?\.direction \?\? \(sessionLang === 'he' \? 'rtl' : 'ltr'\)\}/);
  assert.match(users, /dir="ltr"/);
  assert.doesNotMatch(users, /useI18n|i18n/);
});

test('8. Clients table inherits page direction so Name is the start-edge column', () => {
  const clients = read('../src/pages/Clients.tsx');
  const css = read('../src/styles/nx-clients.css');
  assert.match(clients, /t\('clients\.table\.name'\)/);
  assert.doesNotMatch(css, /text-align:\s*left/);
  assert.doesNotMatch(css, /\.nx-clients-table[^{]*\{[^}]*direction:\s*ltr/);
  assert.match(css, /\.nx-ltr \{[\s\S]*direction:\s*ltr;[\s\S]*unicode-bidi:\s*isolate/);
});

test('11. email, phone, URL, and identifiers stay LTR', () => {
  const clients = read('../src/pages/Clients.tsx');
  const users = read('../src/pages/UsersRoles.tsx');
  assert.match(clients, /className=\{`nx-glass-input nx-ltr\$\{createInvalidField === 'tax_id'/);
  assert.match(clients, /className="nx-glass-input nx-ltr"/);
  assert.match(clients, /className="nx-clients-table__mono nx-ltr"/);
  assert.match(clients, /<td className="nx-ltr">\{r\.email\}<\/td>/);
  assert.match(users, /type="email"[\s\S]*dir="ltr"/);
});

test('14b. EN/HE sidebar nav keys match and Hebrew is not English', () => {
  const enNav = flatten(en.nav).sort();
  const heNav = flatten(he.nav).sort();
  assert.deepEqual(heNav, enNav);
  const heDict = he.nav as Record<string, string>;
  assert.equal(heDict.dashboard, 'לוח בקרה');
  assert.notEqual(heDict.settings, 'Settings');
  assert.notEqual(heDict.usersRoles, 'Users & Roles');
});

test('14. EN/HE translation keys match for office Clients chrome', () => {
  const enKeys = flatten(en.clients).sort();
  const heKeys = flatten(he.clients).sort();
  assert.deepEqual(heKeys, enKeys);
  for (const required of [
    'title',
    'importCsv',
    'exportCsv',
    'selectOrganization',
    'statusValue.active',
    'lifecycleValue.lead',
    'bulk.selected',
    'import.preview',
    'import.confirm',
    'create.title',
    'errors.bulkFailed',
    'errors.previewFailed',
  ]) {
    assert.ok(enKeys.includes(required), `missing EN clients.${required}`);
    assert.ok(heKeys.includes(required), `missing HE clients.${required}`);
  }
});

test('15. invite and CSV command contracts are unchanged', () => {
  const users = read('../src/pages/UsersRoles.tsx');
  const clients = read('../src/pages/Clients.tsx');
  assert.match(users, /orgMembersInvite\(orgId\)/);
  assert.match(users, /fetchUsersRolesAggregate/);
  assert.doesNotMatch(users, /method: 'PATCH'/);
  assert.match(clients, /orgClientsImportPreview/);
  assert.match(clients, /orgClientsImport/);
  assert.match(clients, /orgClientsExport/);
  assert.doesNotMatch(clients, /method: 'PATCH'/);
});
