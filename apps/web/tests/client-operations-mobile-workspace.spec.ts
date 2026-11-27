import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const view = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const css = readFileSync(join(dir, '../src/styles/nx-client-operations-spreadsheet.css'), 'utf8');
const shell = readFileSync(join(dir, '../src/styles/nx-client-operations-shell.css'), 'utf8');
const en = JSON.parse(readFileSync(join(dir, '../src/i18n/en.json'), 'utf8'));
const he = JSON.parse(readFileSync(join(dir, '../src/i18n/he.json'), 'utf8'));

test('CO mobile workspace is composition to 768px, not a shrunk Excel sheet', () => {
  assert.match(css, /@media \(max-width: 768px\)/);
  assert.match(css, /is-mobile-tools-open/);
  assert.match(css, /is-mobile-filters-open/);
  assert.match(css, /nx-co-registry__kpis \{\s*overflow-x:\s*scroll/);
  assert.match(css, /data-col='client_name'/);
  assert.match(view, /max-width: 768px/);
  assert.match(view, /client-operations-mobile-tools/);
  assert.match(view, /client-operations-mobile-filters/);
  assert.match(view, /if \(mobileWorkspace\) openClientModal\(row\)/);
  assert.match(view, /moduleClientOperationsCase/);
  assert.match(shell, /@media \(max-width: 768px\)[\s\S]*nx-co-app-header/);
  assert.equal(en.clientOperations.mobileTools, 'Tools');
  assert.equal(he.clientOperations.mobileTools, 'כלים');
});

test('desktop Excel toolbar remains the default outside the mobile media query', () => {
  const desktopToolbar = css.slice(0, css.indexOf('/* Mobile workspace:'));
  assert.match(desktopToolbar, /\.nx-co-sheet__toolbar \{/);
  assert.doesNotMatch(
    desktopToolbar,
    /\.nx-co-sheet:not\(\.is-mobile-tools-open\) \.nx-co-sheet__toolbar-group:not/,
  );
});
