/**
 * Sidebar labels come from existing I18nProvider keys, keyed by session path.
 * Backend English/nav_label strings are fallback only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sidebarNavI18nKey, sidebarNavLabel } from '../src/lib/sidebar-nav-label.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');
const en = JSON.parse(read('../src/i18n/en.json')) as { nav: Record<string, string> };
const he = JSON.parse(read('../src/i18n/he.json')) as { nav: Record<string, string> };

const heT = (key: string) => {
  const leaf = key.split('.').pop() ?? '';
  return he.nav[leaf] ?? key;
};

test('Hebrew nav keys cover every core sidebar path', () => {
  assert.deepEqual(Object.keys(he.nav).sort(), Object.keys(en.nav).sort());
  assert.equal(he.nav.dashboard, 'לוח בקרה');
  assert.equal(he.nav.settings, 'הגדרות');
  assert.equal(he.nav.usersRoles, 'משתמשים ותפקידים');
  assert.equal(he.nav.clients, 'לקוחות');
  assert.equal(he.nav.documents, 'מסמכים');
  assert.equal(he.nav.modules, 'מודולים');
  assert.equal(he.nav.billing, 'חיוב');
  assert.equal(sidebarNavLabel('/dashboard', 'Dashboard', heT), 'לוח בקרה');
  assert.equal(sidebarNavLabel('/users-roles', 'Users & Roles', heT), 'משתמשים ותפקידים');
  assert.equal(sidebarNavLabel('/m/client-operations', 'Nodex לקוחות', heT), 'תפעול לקוחות');
  assert.equal(sidebarNavLabel('/m/income', 'Income', heT), 'הכנסות');
  assert.equal(sidebarNavI18nKey('/m/docflow/review'), 'nav.docflowReview');
  assert.equal(sidebarNavLabel('/unknown-module', 'Custom', heT), 'Custom');
});

test('AppShell translates session nav through existing useI18n; AppSidebar icons follow path', () => {
  const shell = read('../src/components/layout/AppShell.tsx');
  const sidebar = read('../src/templates/template-1/components/AppSidebar.tsx');
  assert.match(shell, /sidebarNavLabel\(n\.path, n\.label, t\)/);
  assert.match(shell, /sidebarNavLabel\(c\.path, c\.label, t\)/);
  assert.match(sidebar, /function iconForNavItem\(to: string, label: string\)/);
  assert.match(sidebar, /if \(p === '\/dashboard'\) return '📊'/);
  assert.match(sidebar, /iconForNavItem\(child\.to, child\.label\)/);
});
