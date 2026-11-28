import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

const tokens = read('../src/templates/template-1/tokens.css');
const mobile = read('../src/styles/nx-mobile-office.css');
const layout = read('../src/templates/template-1/TemplateLayout.tsx');
const dashboard = read('../src/pages/Dashboard.tsx');
const sidebar = read('../src/templates/template-1/components/SidebarAccountBlock.tsx');
const coCss = read('../src/styles/nx-client-operations-spreadsheet.css');
const dashCss = read('../src/styles/nx-dashboard.css');

test('mobile hamburger is physical left and imported into the working shell', () => {
  assert.match(layout, /nx-mobile-office\.css/);
  assert.match(tokens, /left:\s*10px/);
  assert.match(mobile, /html\[dir='rtl'\] \.t1-mobile-nav-toggle/);
  assert.doesNotMatch(
    tokens.slice(tokens.indexOf('@media (max-width: 768px)')),
    /inset-inline-start:\s*10px/,
  );
  assert.match(tokens, /@media \(max-width: 430px\)[\s\S]*padding:\s*56px 8px 16px/);
});

test('mobile hides page language chips and keeps the sidebar language selector', () => {
  assert.match(mobile, /\.nx-dashboard__header-tools \.nx-glass-lang[\s\S]*display:\s*none/);
  assert.match(sidebar, /onSetLanguage\(code\)/);
  assert.match(sidebar, /sidebar-language-selector/);
  assert.match(dashboard, /UiLanguageSwitch compact/);
});

test('mobile dashboard and CO KPIs use a two-column grid without page-level KPI scroll', () => {
  assert.match(dashCss, /@media \(max-width: 640px\)[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(coCss, /nx-co-registry__kpis \{\s*overflow-x:\s*hidden/);
  assert.match(mobile, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test('dashboard overview uses session locale so language sync does not double-fetch', () => {
  assert.match(dashboard, /sidebar_account_block\.language_selector\.current_value/);
  assert.match(dashboard, /sessionLocale/);
});
