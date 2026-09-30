/**
 * Client Operations — route header + header search relocation (presentation only).
 *
 * Contract:
 *  - CO route header shows "ניהול לקוחות" on the right (RTL) and NO duplicated
 *    account / language chrome (owned by the sidebar account block).
 *  - Inner sheet title "תפעול לקוחות" is no longer rendered.
 *  - The EXISTING search renderer is portaled into the header slot — one state,
 *    one debounce, one clear path, one aggregate `onQueryChange` path.
 *  - Other routes keep the generic AppHeader (org / language / user chrome).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

const layoutSource = read('../src/templates/template-1/TemplateLayout.tsx');
const appHeaderSource = read('../src/templates/template-1/components/AppHeader.tsx');
const coHeaderSource = read('../src/templates/template-1/components/ClientOperationsAppHeader.tsx');
const slotSource = read('../src/components/client-operations/ClientOperationsHeaderSearchSlot.tsx');
const viewSource = read('../src/components/client-operations/ClientOperationsRegistryView.tsx');
const pageSource = read('../src/pages/ClientOperationsRegistry.tsx');
const shellCss = read('../src/styles/nx-client-operations-shell.css');
const sheetCss = read('../src/styles/nx-client-operations-spreadsheet.css');

/** Slice of the view between the toolbar renderer and the filter-bar renderer. */
const toolbarSlice = (() => {
  const start = viewSource.indexOf('const renderSpreadsheetToolbar = () => {');
  const end = viewSource.indexOf('const renderFilterBar = () => {');
  assert.ok(start > 0 && end > start, 'toolbar / filter-bar renderers must exist in order');
  return viewSource.slice(start, end);
})();

test('1 CO route header shows ניהול לקוחות as the module title', () => {
  assert.match(coHeaderSource, /CLIENT_OPERATIONS_HEADER_TITLE_HE = 'ניהול לקוחות'/);
  assert.match(coHeaderSource, /<h1 className="nx-co-app-header__title">\{CLIENT_OPERATIONS_HEADER_TITLE_HE\}<\/h1>/);
  assert.match(layoutSource, /isClientOperationsModule \? \(\s*<ClientOperationsAppHeader/);
});

test('1b title sits on the RIGHT (RTL header, title at inline-start)', () => {
  assert.match(coHeaderSource, /<header className="nx-co-app-header" dir="rtl"/);
  // Title wrap is the first grid cell → inline-start → right side under dir=rtl.
  assert.match(
    coHeaderSource,
    /<header[^>]*>\s*<div className="nx-co-app-header__title-wrap">/,
  );
  assert.match(shellCss, /\.nx-co-app-header__title-wrap\s*\{[^}]*justify-self:\s*start/);
});

test('2 duplicate inner title תפעול לקוחות is not rendered in the sheet', () => {
  assert.doesNotMatch(viewSource, /<h1 className="nx-co-sheet__title">/);
  assert.doesNotMatch(viewSource, /\{titleHe \?\? 'תפעול לקוחות'\}/);
  // Toolbar is now the first child of the sheet root — no empty title gap.
  assert.match(
    viewSource,
    /data-fullscreen=\{fullscreenOpen \? 'true' : 'false'\}\s*>\s*\{\/\*[^*]*\*\/\}\s*\{renderSpreadsheetToolbar\(\)\}/,
  );
  // Print HTML keeps its own document heading (separate print renderer, unchanged).
  assert.match(viewSource, /<h1>תפעול לקוחות — \$\{periodHeading\}<\/h1>/);
});

test('3 CO header hides duplicated account / language chrome', () => {
  assert.doesNotMatch(coHeaderSource, /topBar\.language/);
  assert.doesNotMatch(coHeaderSource, /<select/);
  assert.doesNotMatch(coHeaderSource, /onSelectOrg|onSignOut|user\.fullName|user\.email|activeOrg/);
  assert.doesNotMatch(coHeaderSource, /useI18n/);
  // No fake chrome either.
  assert.doesNotMatch(coHeaderSource, /Add Client|הוסף לקוח|notification|התראות|help|עזרה|settings|הגדרות/i);
  // Layout never renders the generic AppHeader on the CO route.
  assert.match(
    layoutSource,
    /header = isClientOperationsModule \? \(\s*<ClientOperationsAppHeader searchSlotRef=\{coHeaderSearchSlotRef\} \/>\s*\) : \(\s*<AppHeader/,
  );
});

test('4 search field renderer exists exactly once (single renderSearchField)', () => {
  const inputs = viewSource.match(/type="search"/g) ?? [];
  assert.equal(inputs.length, 1, 'exactly one <input type="search"> in the registry view');
  const placeholders = viewSource.match(/placeholder="חיפוש בטבלה…"/g) ?? [];
  assert.equal(placeholders.length, 1);
  assert.match(viewSource, /const renderSearchField = \(placement: 'header' \| 'toolbar'\) =>/);
  assert.match(viewSource, /data-testid="client-operations-search"/);
  assert.doesNotMatch(coHeaderSource, /type="search"|<input/);
});

test('5 search is portaled to the header slot — not in the old toolbar group', () => {
  assert.match(viewSource, /import \{ createPortal \} from 'react-dom'/);
  assert.match(viewSource, /const searchInHeader = Boolean\(headerSearchSlot\) && !fullscreenOpen;/);
  assert.match(
    toolbarSlice,
    /searchInHeader && headerSearchSlot\s*\? createPortal\(renderSearchField\('header'\), headerSearchSlot\)/,
  );
  // Old static toolbar search group is gone.
  assert.doesNotMatch(
    toolbarSlice,
    /<div className="nx-co-sheet__toolbar-group">\s*<div className="nx-co-sheet__search">/,
  );
  // Inline fallback only when there is no header slot (or the fullscreen sheet covers the header).
  assert.match(toolbarSlice, /nx-co-sheet__toolbar-group--search-fallback/);
  // Header exposes the slot; layout wires the slot ref → context → view.
  assert.match(coHeaderSource, /ref=\{searchSlotRef\}/);
  assert.match(coHeaderSource, /CLIENT_OPERATIONS_HEADER_SEARCH_SLOT_TEST_ID/);
  assert.match(layoutSource, /ClientOperationsHeaderSearchSlotContext\.Provider/);
  assert.match(layoutSource, /value=\{isClientOperationsModule \? coHeaderSearchSlot : null\}/);
  assert.match(slotSource, /createContext<HTMLElement \| null>\(null\)/);
  assert.match(viewSource, /const headerSearchSlot = useClientOperationsHeaderSearchSlot\(\);/);
});

test('6 header search drives the same canonical search query (one state, one path)', () => {
  // Exactly one searchDraft state and one debounce ref in the view.
  assert.equal((viewSource.match(/useState\(query\?\.q \?\? ''\)/g) ?? []).length, 1);
  assert.equal((viewSource.match(/const searchDebounceRef = useRef/g) ?? []).length, 1);
  // The single renderer binds that state and the existing handlers.
  assert.match(viewSource, /const renderSearchField[\s\S]*?value=\{searchDraft\}[\s\S]*?onChange=\{\(e\) => onSearchDraftChange\(e\.target\.value\)\}/);
  assert.match(viewSource, /const renderSearchField[\s\S]*?applyLiveSearch\(searchDraft\)/);
  // applyLiveSearch → onQueryChange({ q, ... }, { quiet: true }) — aggregate read, not a command.
  assert.match(viewSource, /const applyLiveSearch = useCallback\([\s\S]*?onQueryChange\(\s*\{\s*q,/);
  assert.doesNotMatch(viewSource, /const applyLiveSearch[\s\S]{0,900}onRegistryCommand/);
  // No search state / handler in header or layout — header is a dumb slot.
  assert.doesNotMatch(coHeaderSource, /useState|onChange|searchDraft|onQueryChange/);
  assert.doesNotMatch(layoutSource, /searchDraft|onQueryChange|setSearch/);
  const slotCode = slotSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(slotCode, /useState|onQueryChange/);
});

test('7 clear still works — native clear / empty draft restores immediately', () => {
  assert.match(viewSource, /if \(!value\.trim\(\)\) \{\s*applyLiveSearch\(''\);\s*return;\s*\}/);
  assert.match(viewSource, /const q = raw\.trim\(\) \|\| null;/);
  // Debounce unchanged (120ms) for typing.
  assert.match(viewSource, /searchDebounceRef\.current = setTimeout\(\(\) => \{\s*applyLiveSearch\(value\);\s*\}, 120\);/);
  // Native X stays visible on the dark header glass.
  assert.match(shellCss, /\.nx-co-sheet__search--header input::-webkit-search-cancel-button/);
});

test('8 filters + search remain combinable (search carries active filters; filters carry q)', () => {
  assert.match(
    viewSource,
    /const applyLiveSearch = useCallback\([\s\S]*?filter_operational_reporting: query\?\.filter_operational_reporting \?\? null,[\s\S]*?filter_handler: query\?\.filter_handler \?\? null,/,
  );
  assert.match(
    viewSource,
    /const applyBusinessFilterChange = useCallback\([\s\S]*?q: query\?\.q \?\? null,/,
  );
  assert.match(viewSource, /const clearBusinessFilters = useCallback\([\s\S]*?q: query\?\.q \?\? null,/);
  // Page merges next query over current (q + filters + period) — untouched.
  assert.match(pageSource, /\.\.\.query,\s*\.\.\.next,\s*operational_period_key: query\.operational_period_key,/);
});

test('9 unrelated routes retain account / language header chrome', () => {
  // Generic AppHeader still renders org selector, language select and user menu.
  assert.match(appHeaderSource, /t\('topBar\.language'\)/);
  assert.match(appHeaderSource, /<option value="en">EN<\/option>/);
  assert.match(appHeaderSource, /\{user\.fullName \|\| user\.email\}/);
  assert.match(appHeaderSource, /activeOrg\?\.name \?\? 'Select organization'/);
  assert.match(appHeaderSource, /t\('topBar\.signOut'\)/);
  // Layout still renders it for every non-CO, non-queue route.
  assert.match(layoutSource, /<AppHeader\s+organizations=\{organizations\}/);
  assert.match(layoutSource, /if \(!isWorkEngineQueuePage\) \{/);
  // Slot context is null off the CO route → view falls back to inline search.
  assert.match(layoutSource, /isClientOperationsModule \? coHeaderSearchSlot : null/);
});

test('10 header styles: dark blue glass search, approved palette — scoped to CO only', () => {
  assert.match(shellCss, /\.nx-co-app-header\s*\{[^}]*linear-gradient\(\s*90deg,\s*#082447/);
  assert.match(
    shellCss,
    /\.nx-co-app-header \.nx-co-sheet__search--header input\s*\{[^}]*linear-gradient\(\s*180deg,\s*rgba\(13, 55, 100, 0\.78\)/,
  );
  assert.match(shellCss, /--nx-navy-950: #061a33/);
  assert.match(shellCss, /--nx-navy-900: #082447/);
  assert.match(shellCss, /--nx-navy-850: #0a2d55/);
  assert.match(shellCss, /--nx-navy-800: #0d3764/);
  assert.match(shellCss, /--nx-blue-500: #268cff/);
  assert.match(shellCss, /--nx-cyan-500: #00cfef/);
  assert.match(shellCss, /--nx-cyan-400: #39e6f4/);
  assert.match(shellCss, /--nx-cyan-300: #7decf7/);
  assert.match(shellCss, /--nx-violet-500: #6657e8/);
  assert.match(shellCss, /--nx-violet-400: #8074f2/);
  assert.match(sheetCss, /border:\s*1px solid rgba\(125, 236, 247, 0\.55\)/);
  assert.match(
    sheetCss,
    /\.nx-co-sheet__period-tab\.is-current-working-period\s*\{[^}]*linear-gradient\(135deg, #1477e8 0%, #00cfef 100%\)/,
  );
  assert.match(sheetCss, /border:\s*1px solid #7decf7/);
  // Old generic-header overrides for the CO route are gone (no header chrome to restyle).
  assert.doesNotMatch(shellCss, /> div > header > div > label > select/);
  // Every shell rule is scoped: either under the CO shell class or the CO header class.
  const selectors = shellCss
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map((chunk) => chunk.split('{')[0]?.trim() ?? '')
    .filter(Boolean);
  for (const sel of selectors) {
    assert.ok(
      /^\.t1-appShell--client-operations/.test(sel) || /^\.nx-co-app-header/.test(sel),
      `unscoped selector in CO shell css: ${sel}`,
    );
  }
});
