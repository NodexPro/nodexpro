import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sidebarNavLabel } from '../src/lib/sidebar-nav-label.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');
const en = JSON.parse(read('../src/i18n/en.json')) as { nav: Record<string, string>; billing: { title: string } };
const he = JSON.parse(read('../src/i18n/he.json')) as { nav: Record<string, string>; billing: { title: string } };

const tFor = (dict: { nav: Record<string, string> }) => (key: string) => {
  const leaf = key.split('.').pop() ?? '';
  return dict.nav[leaf] ?? key;
};

test('LTR/RTL nested module rows use logical start indent, not physical left padding', () => {
  const sidebar = read('../src/templates/template-1/components/AppSidebar.tsx');
  const accountCss = read('../src/templates/template-1/t1-sidebar-account.css');
  const shellCss = read('../src/styles/nx-client-operations-shell.css');
  assert.match(accountCss, /\.t1-sidebar__link-child \{[\s\S]*?padding-inline-start:\s*36px/);
  assert.match(accountCss, /\.t1-sidebar__link-child \{[\s\S]*?padding-inline-end:\s*12px/);
  assert.match(accountCss, /\.t1-sidebar__icon \+ span \{[\s\S]*?margin-inline-start:\s*8px/);
  assert.match(shellCss, /\.t1-sidebar__link-child \{[\s\S]*?padding-inline-start:\s*36px/);
  assert.doesNotMatch(sidebar, /padding:\s*'0 12px 0 36px'/);
  assert.doesNotMatch(sidebar, /marginLeft:\s*8/);
  assert.doesNotMatch(accountCss, /\.t1-sidebar__link-child[^{]*\{[^}]*padding-left:\s*36px/);
  assert.doesNotMatch(shellCss, /\.t1-sidebar__link-child[^{]*\{[^}]*padding-left:\s*36px/);
});

test('EN and HE keep the same backend-owned Modules nesting; labels follow I18nProvider', () => {
  const shell = read('../src/components/layout/AppShell.tsx');
  assert.match(shell, /n\.path === '\/modules' && moduleChildren\.length/);
  assert.match(shell, /children: moduleChildren/);
  assert.doesNotMatch(shell, /label === ['"]Modules['"]/);
  assert.doesNotMatch(shell, /label === ['"]מודולים['"]/);
  assert.equal(en.nav.clientOperations, 'Client Operations');
  assert.equal(he.nav.clientOperations, 'ניהול לקוחות');
  assert.equal(sidebarNavLabel('/m/client-operations', 'Nodex לקוחות', tFor(en)), 'Client Operations');
  assert.equal(sidebarNavLabel('/m/client-operations', 'Nodex לקוחות', tFor(he)), 'ניהול לקוחות');
  assert.equal(sidebarNavLabel('/modules', 'Modules', tFor(en)), 'Modules');
  assert.equal(sidebarNavLabel('/modules', 'Modules', tFor(he)), 'מודולים');
});

test('ניהול לקוחות is the Client Operations header and sidebar item; EN stays Client Operations', () => {
  const header = read('../src/templates/template-1/components/ClientOperationsAppHeader.tsx');
  assert.match(header, /CLIENT_OPERATIONS_HEADER_TITLE_HE = 'ניהול לקוחות'/);
  assert.equal(he.nav.clientOperations, 'ניהול לקוחות');
  assert.equal(en.nav.clientOperations, 'Client Operations');
  assert.equal(he.nav.clients, 'לקוחות');
});

test('Billing nav and page title use חיובים for the invoices section', () => {
  assert.equal(en.nav.billing, 'Billing');
  assert.equal(he.nav.billing, 'חיובים');
  assert.equal(he.billing.title, 'חיובים');
  assert.equal(sidebarNavLabel('/billing', 'Billing', tFor(he)), 'חיובים');
});

test('I18nProvider flips document direction with language so sidebar logical padding mirrors', () => {
  const i18n = read('../src/i18n/I18nProvider.tsx');
  assert.match(i18n, /document\.documentElement\.dir = lang === 'he' \? 'rtl' : 'ltr'/);
});
