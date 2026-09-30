/**
 * Client Operations — sidebar glass, unified amber accent, header search pending.
 * Presentation / chrome only. Search matching semantics unchanged.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

const shellCss = read('../src/styles/nx-client-operations-shell.css');
const sheetCss = read('../src/styles/nx-client-operations-spreadsheet.css');
const sidebarSource = read('../src/templates/template-1/components/AppSidebar.tsx');
const viewSource = read('../src/components/client-operations/ClientOperationsRegistryView.tsx');
const pageSource = read('../src/pages/ClientOperationsRegistry.tsx');
const presentationPure = read(
  '../../api/src/domains/client-operations/client-operations-registry-presentation.pure.ts',
);

test('sidebar CO rail uses exact navy gradient + blue atmospheric radial', () => {
  assert.match(
    shellCss,
    /\.t1-appShell--client-operations \.t1-sidebar\s*\{[^}]*linear-gradient\(\s*180deg,\s*#082447 0%,\s*#0a2d55 55%,\s*#061a33 100%\)/,
  );
  assert.match(
    shellCss,
    /radial-gradient\(\s*ellipse at 0% 65%,\s*rgba\(38, 140, 255, 0\.24\),\s*transparent 65%\)/,
  );
});

test('sidebar glass hover + bright active use approved tokens', () => {
  assert.match(
    shellCss,
    /\.t1-appShell--client-operations \.t1-sidebar__link:hover\s*\{[^}]*linear-gradient\(\s*135deg,\s*rgba\(38, 140, 255, 0\.25\),\s*rgba\(0, 207, 239, 0\.13\)\)/,
  );
  assert.match(shellCss, /border:\s*1px solid rgba\(125, 236, 247, 0\.38\)/);
  assert.match(shellCss, /backdrop-filter:\s*blur\(12px\)/);
  assert.match(shellCss, /transition:[\s\S]*160ms ease/);
  assert.match(
    shellCss,
    /\.t1-appShell--client-operations \.t1-sidebar__link\.is-active,\s*\.t1-appShell--client-operations \.t1-sidebar__link\.is-active:hover\s*\{[^}]*linear-gradient\(\s*135deg,\s*#1477e8,\s*#00cfef\)/,
  );
  assert.match(shellCss, /border:\s*1px solid #7decf7/);
  assert.match(shellCss, /color:\s*#a9c9ee/);
  assert.match(shellCss, /color:\s*#7decf7/);
});

test('CO sidebar glyph path is appearance-scoped (coGlass); emoji path preserved otherwise', () => {
  assert.match(sidebarSource, /const coGlass = appearance === 'co-navy-glass'/);
  assert.match(sidebarSource, /function CoNavGlyph/);
  assert.match(sidebarSource, /coGlass \? <CoNavGlyph icon=\{item\.icon\} \/> : item\.icon/);
});

test('unified amber tokens cover search X, folders, and מוכן paint indicator', () => {
  assert.match(sheetCss, /--nx-amber-500:\s*#ffbf47/);
  assert.match(sheetCss, /--nx-amber-300:\s*#ffd67a/);
  assert.match(sheetCss, /--nx-amber-200:\s*#ffe29a/);
  assert.match(sheetCss, /--nx-amber-700:\s*#c98216/);
  assert.match(sheetCss, /::-webkit-search-cancel-button[\s\S]*?background-color:\s*var\(--nx-amber-500/);
  assert.match(sheetCss, /::-webkit-search-cancel-button:hover[\s\S]*?--nx-amber-200/);
  assert.match(viewSource, /function ClientOperationsFolderIcon/);
  assert.match(sheetCss, /\.nx-co-sheet__folder-icon \.nx-co-sheet__folder-back/);
  assert.match(
    sheetCss,
    /\.nx-co-sheet__status-mode--ready \.nx-co-sheet__status-mode-swatch\s*\{[^}]*--nx-amber-500/,
  );
  // Painted cell tones remain separate from the toolbar indicator.
  assert.match(sheetCss, /\.nx-co-sheet__table td\.is-manual-status-ready/);
});

test('header search pending indicator: spinner + מחפש... + no layout shift contract', () => {
  assert.match(pageSource, /const \[queryRefreshPending, setQueryRefreshPending\] = useState\(false\)/);
  assert.match(pageSource, /searchPending=\{queryRefreshPending\}/);
  assert.match(viewSource, /searchDebouncePending \|\| searchPending/);
  assert.match(viewSource, /data-testid="client-operations-search-pending"/);
  assert.match(viewSource, /מחפש\.\.\./);
  assert.match(viewSource, /role="status"/);
  assert.match(viewSource, /aria-live="polite"/);
  assert.match(sheetCss, /\.nx-co-sheet__search-pending/);
  assert.match(sheetCss, /\.nx-co-sheet__search-spinner/);
  // Debounce unchanged.
  assert.match(viewSource, /}, 120\);/);
});

test('search matching remains backend post-filter over client_name + cells (incl. tax_id)', () => {
  assert.match(presentationPure, /key: 'tax_id'/);
  assert.match(
    presentationPure,
    /if \(\(r\.client_name \?\? ''\)\.toLowerCase\(\)\.includes\(q\)\) return true;/,
  );
  assert.match(
    presentationPure,
    /return Object\.values\(r\.cells\)\.some\(\(v\) => v\.toLowerCase\(\)\.includes\(q\)\);/,
  );
  // No FE filtering of registry rows by q.
  assert.doesNotMatch(viewSource, /rows\.filter\(\(r\).*client_name.*includes/);
  assert.doesNotMatch(pageSource, /rows\.filter\(\(r\).*includes\(.*q/);
});
