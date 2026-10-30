/**
 * Client Operations workspace restyle — Deep Ocean Glass, scoped to .nx-co-sheet.
 * Reuses Create Client / Dashboard tokens. Does not restyle sidebar or other modules.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');
const sheetCss = read('../src/styles/nx-client-operations-spreadsheet.css');
const shellCss = read('../src/styles/nx-client-operations-shell.css');
const createCss = read('../src/styles/nx-client-create-deep-ocean-glass.css');
const dashboardCss = read('../src/styles/nx-dashboard.css');
const he = JSON.parse(read('../src/i18n/he.json')) as { nav: Record<string, string> };
const en = JSON.parse(read('../src/i18n/en.json')) as { nav: Record<string, string> };

test('CO sheet reuses Deep Ocean tokens from Create Client and Dashboard', () => {
  assert.match(createCss, /#123756|#102[Dd]49|#17547[Aa]|#36[Aa]9[Cc]6|#13[Bb][Ff][Dd]0/);
  assert.match(dashboardCss, /rgba\(54, 169, 198/);
  assert.match(sheetCss, /--nx-ocean-base: #123756/);
  assert.match(sheetCss, /--nx-ocean-border: #36a9c6/);
  assert.match(sheetCss, /--nx-ocean-accent: #13bfd0/);
  assert.match(
    sheetCss,
    /\.nx-co-sheet \{[\s\S]*?linear-gradient\(180deg, rgba\(18, 55, 86, 0\.46\) 0%, rgba\(16, 45, 73, 0\.52\) 100%\)/,
  );
  assert.match(sheetCss, /backdrop-filter: blur\(22px\) saturate\(1\.25\)/);
});

test('data cells stay white with dark text; headers are blue-cyan glass', () => {
  assert.match(sheetCss, /--nx-table-bg: #ffffff/);
  assert.match(sheetCss, /--nx-table-alt: #ffffff/);
  assert.match(sheetCss, /\.nx-co-sheet__table td \{\s*color: var\(--nx-text-primary\)/);
  assert.match(
    sheetCss,
    /\.nx-co-sheet__table thead th \{[\s\S]*?linear-gradient\(180deg, rgba\(210, 238, 255, 0\.92\) 0%, rgba\(186, 216, 246, 0\.82\) 100%\)/,
  );
  assert.match(sheetCss, /\.nx-co-sheet__table thead th \{[\s\S]*?color: #123756/);
  assert.match(sheetCss, /--nx-grid: #cfe4f2/);
});

test('toolbar, filters, buttons and month tabs share compact ocean glass chrome', () => {
  assert.match(sheetCss, /\.nx-co-sheet__toolbar \{[\s\S]*?rgba\(54, 169, 198, 0\.58\)/);
  assert.match(sheetCss, /\.nx-co-sheet__filter-bar \{[\s\S]*?rgba\(54, 169, 198, 0\.58\)/);
  assert.match(
    sheetCss,
    /\.nx-co-sheet__btn \{[\s\S]*?border-radius: 6px[\s\S]*?padding: 6px 12px/,
  );
  assert.match(
    sheetCss,
    /\.nx-co-sheet__period-tab\.is-current-working-period \{[\s\S]*?0 0 16px rgba\(19, 191, 208, 0\.38\)/,
  );
});

test('restyle is scoped to the CO sheet; sidebar and other modules are untouched', () => {
  assert.doesNotMatch(sheetCss, /^[^/\n{]*\b(body|html|\.t1-sidebar|\.nx-dashboard)\s*\{/m);
  const sidebarBlock = shellCss.slice(
    shellCss.indexOf('.t1-appShell--client-operations .t1-sidebar {'),
    shellCss.indexOf('.t1-appShell--client-operations .t1-sidebar__brand-name'),
  );
  assert.match(sidebarBlock, /linear-gradient\(180deg, #082447 0%, #0a2d55 55%, #061a33 100%\)/);
});

test('Hebrew module label is ניהול לקוחות; English stays Client Operations', () => {
  assert.equal(he.nav.clientOperations, 'ניהול לקוחות');
  assert.equal(en.nav.clientOperations, 'Client Operations');
  const view = read('../src/components/client-operations/ClientOperationsRegistryView.tsx');
  assert.match(view, /ניהול לקוחות — \$\{periodHeading\}/);
  assert.doesNotMatch(view, /תפעול לקוחות/);
});
