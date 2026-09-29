/**
 * Source-level assertions for formatting, print, and resize features.
 * Reads source files as text — no DOM required, runnable with --experimental-strip-types.
 * Pure-logic runtime assertions live in the companion *.pure.spec.ts files.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

const viewSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const cssSource = readFileSync(
  join(dir, '../src/styles/nx-client-operations-spreadsheet.css'),
  'utf8',
);
const paletteSource = readFileSync(
  join(dir, '../src/lib/client-operations-text-color-palette.pure.ts'),
  'utf8',
);
const fontSizeSource = readFileSync(
  join(dir, '../src/lib/client-operations-font-size.pure.ts'),
  'utf8',
);
const resizeSource = readFileSync(
  join(dir, '../src/lib/client-operations-column-resize.pure.ts'),
  'utf8',
);
const printSource = readFileSync(
  join(dir, '../src/lib/client-operations-print.pure.ts'),
  'utf8',
);
const visibilitySource = readFileSync(
  join(dir, '../src/lib/client-operations-column-visibility.pure.ts'),
  'utf8',
);
const undoSource = readFileSync(
  join(dir, '../src/lib/client-operations-undo-stack.pure.ts'),
  'utf8',
);

// ── Palette: exactly 12 swatches ─────────────────────────────────────────────

test('palette pure: exactly 12 swatches declared in array', () => {
  // Match swatch literals: { id: 'identifier' — excludes type definition which uses { id: string
  const swatchBlocks = paletteSource.match(/\{\s*id:\s*'/g);
  assert.ok(swatchBlocks, 'No swatch literal objects found in palette source');
  assert.equal(swatchBlocks!.length, 12, `Expected 12 swatches, got ${swatchBlocks!.length}`);
});

test('palette pure: has standard and beautiful row variants', () => {
  assert.match(paletteSource, /row:\s*'standard'/);
  assert.match(paletteSource, /row:\s*'beautiful'/);
});

test('palette pure: default text color is dark ink', () => {
  assert.match(paletteSource, /CLIENT_OPERATIONS_DEFAULT_TEXT_COLOR\s*=\s*'#111827'/);
});

test('palette pure: clientOperationsTextColorPaletteRows exported', () => {
  assert.match(paletteSource, /export function clientOperationsTextColorPaletteRows/);
});

// ── Font-size control ────────────────────────────────────────────────────────

test('font-size pure: default is 12 (control default, not forced on cells)', () => {
  assert.match(fontSizeSource, /CLIENT_OPERATIONS_DEFAULT_FONT_SIZE.*=.*12/);
});

test('font-size pure: sizes array includes standard values', () => {
  assert.match(fontSizeSource, /CLIENT_OPERATIONS_FONT_SIZES/);
  assert.match(fontSizeSource, /8.*9.*10.*11.*12/s);
  assert.match(fontSizeSource, /14.*16.*18.*20.*24/s);
});

test('font-size pure: normalizeClientOperationsFontSize exported', () => {
  assert.match(fontSizeSource, /export function normalizeClientOperationsFontSize/);
});

// ── Column resize: RTL-aware delta function ──────────────────────────────────

test('resize pure: handle edge is inline-start (RTL-first CSS)', () => {
  assert.match(resizeSource, /CLIENT_OPERATIONS_RESIZE_HANDLE_EDGE.*=.*'inline-start'/);
});

test('resize pure: computeClientOperationsColumnResizeDelta handles RTL by checking physical right', () => {
  assert.match(resizeSource, /handleIsPhysicalRight/);
  assert.match(resizeSource, /direction.*===.*'rtl'/);
  assert.match(resizeSource, /handleEdge.*===.*'inline-start'/);
});

test('resize pure: RTL inline-start maps to physical right (grows when moving right)', () => {
  // The logic: (inline-start + rtl) => physical right => positive delta means grow
  assert.match(resizeSource, /handleEdge === 'inline-start' && input\.direction === 'rtl'/);
  assert.match(resizeSource, /handleIsPhysicalRight \? physicalDelta : -physicalDelta/);
});

// ── Print: meaningful column selection ──────────────────────────────────────

test('print pure: folder always excluded', () => {
  assert.match(printSource, /column\.key === 'folder'.*continue/s);
});

test('print pure: client_name always included', () => {
  assert.match(printSource, /column\.key === 'client_name'/);
  assert.match(printSource, /out\.push\(column\.key\)/);
});

test('print pure: selectPrintableColumnKeys exported', () => {
  assert.match(printSource, /export function selectPrintableColumnKeys/);
});

test('print pure: formatClientOperationsPeriodHeading exported', () => {
  assert.match(printSource, /export function formatClientOperationsPeriodHeading/);
});

test('print pure: isMeaningfulPrintableCellValue handles dash variants', () => {
  assert.match(printSource, /EMPTY_DISPLAY/);
  assert.match(printSource, /'—'/);
});

// ── Column visibility: mandatory keys ────────────────────────────────────────

test('visibility pure: mandatory keys include folder and client_name', () => {
  assert.match(visibilitySource, /CLIENT_OPERATIONS_MANDATORY_VISIBLE_COLUMN_KEYS.*folder.*client_name/s);
});

test('visibility pure: toggleClientOperationsHiddenColumn guards mandatory keys', () => {
  assert.match(visibilitySource, /isClientOperationsMandatoryVisibleColumn\(columnKey\)/);
  assert.match(visibilitySource, /return next/); // guard returns unchanged set
});

test('visibility pure: isClientOperationsMandatoryVisibleColumn exported', () => {
  assert.match(visibilitySource, /export function isClientOperationsMandatoryVisibleColumn/);
});

// ── Undo stack: column_visibility and column_width entries ────────────────────

test('undo stack pure: column_visibility entry type defined', () => {
  assert.match(undoSource, /kind:\s*'column_visibility'/);
  assert.match(undoSource, /previousHiddenKeys:\s*string\[\]/);
});

test('undo stack pure: column_width entry type defined', () => {
  assert.match(undoSource, /kind:\s*'column_width'/);
  assert.match(undoSource, /previousWidth:\s*number/);
  assert.match(undoSource, /nextWidth:\s*number/);
});

test('undo stack pure: fontSize on presentation snapshot', () => {
  assert.match(undoSource, /fontSize\?:\s*number/);
});

// ── View source: new imports and wiring ──────────────────────────────────────

test('view imports color palette pure module', () => {
  assert.match(viewSource, /client-operations-text-color-palette\.pure/);
  assert.match(viewSource, /clientOperationsTextColorPaletteRows/);
  assert.match(viewSource, /CLIENT_OPERATIONS_DEFAULT_TEXT_COLOR/);
});

test('view imports font-size pure module', () => {
  assert.match(viewSource, /client-operations-font-size\.pure/);
  assert.match(viewSource, /CLIENT_OPERATIONS_FONT_SIZES/);
  assert.match(viewSource, /CLIENT_OPERATIONS_DEFAULT_FONT_SIZE/);
});

test('view imports column-resize pure module and uses computeClientOperationsColumnResizeDelta', () => {
  assert.match(viewSource, /client-operations-column-resize\.pure/);
  assert.match(viewSource, /computeClientOperationsColumnResizeDelta/);
  assert.match(viewSource, /CLIENT_OPERATIONS_RESIZE_HANDLE_EDGE/);
});

test('view imports column-visibility module and uses toggle + mandatory check', () => {
  assert.match(viewSource, /client-operations-column-visibility\.pure/);
  assert.match(viewSource, /toggleClientOperationsHiddenColumn/);
  assert.match(viewSource, /isClientOperationsMandatoryVisibleColumn/);
});

test('view imports print pure module and calls selectPrintableColumnKeys', () => {
  assert.match(viewSource, /client-operations-print\.pure/);
  assert.match(viewSource, /selectPrintableColumnKeys/);
  assert.match(viewSource, /formatClientOperationsPeriodHeading/);
});

// ── View source: CellPresentation fontSize ───────────────────────────────────

test('view: CellPresentation type has fontSize field', () => {
  assert.match(viewSource, /fontSize\?:\s*number/);
});

test('view: fontSize applied to cell td style only when explicitly set', () => {
  assert.match(viewSource, /presentation\?\.fontSize\s*!=\s*null/);
  assert.match(viewSource, /`\$\{presentation\.fontSize\}px`/);
});

test('view: fontSize NOT forced on cells by default — only when user chooses', () => {
  // The condition must be != null (not just truthy) so 0-fontSize scenarios are handled
  assert.match(viewSource, /presentation\?\.fontSize\s*!=\s*null/);
});

// ── View source: toolbar data-testid markers ─────────────────────────────────

test('toolbar marker: data-testid="text-color-control"', () => {
  assert.match(viewSource, /data-testid="text-color-control"/);
});

test('toolbar marker: data-testid="font-size-control"', () => {
  assert.match(viewSource, /data-testid="font-size-control"/);
});

test('toolbar marker: data-testid="column-visibility-control"', () => {
  assert.match(viewSource, /data-testid="column-visibility-control"/);
});

test('toolbar marker: data-testid="print-control"', () => {
  assert.match(viewSource, /data-testid="print-control"/);
});

// ── View source: toolbar layout order ────────────────────────────────────────

test('toolbar: B I U alignment buttons present in secondary group', () => {
  assert.match(viewSource, /<strong>B<\/strong>/);
  assert.match(viewSource, /<em>I<\/em>/);
  assert.match(viewSource, /textDecoration.*underline.*U/s);
});

test('toolbar: font-size select uses CLIENT_OPERATIONS_FONT_SIZES', () => {
  assert.match(viewSource, /CLIENT_OPERATIONS_FONT_SIZES\.map/);
  assert.match(viewSource, /font-size-control/);
});

test('toolbar: color-A button shows current color as underline', () => {
  assert.match(viewSource, /nx-co-sheet__color-a-btn/);
  assert.match(viewSource, /nx-co-sheet__color-a-letter/);
  assert.match(viewSource, /borderBottomColor.*currentColor/);
});

test('toolbar: color palette renders 2 rows via paletteRows.standard/beautiful', () => {
  assert.match(viewSource, /paletteRows\.standard/);
  assert.match(viewSource, /paletteRows\.beautiful/);
  assert.match(viewSource, /nx-co-sheet__color-palette-row/);
  assert.match(viewSource, /nx-co-sheet__color-swatch/);
});

test('toolbar: column-visibility icon opens popover', () => {
  assert.match(viewSource, /nx-co-sheet__col-visibility-wrap/);
  assert.match(viewSource, /nx-co-sheet__col-visibility-popover/);
  assert.match(viewSource, /columnVisibilityOpen/);
});

test('toolbar: mandatory columns disabled in visibility popover', () => {
  assert.match(viewSource, /isClientOperationsMandatoryVisibleColumn/);
  assert.match(viewSource, /disabled=\{mandatory\}/);
});

test('toolbar: print button calls handlePrint', () => {
  assert.match(viewSource, /onClick=\{handlePrint\}/);
});

test('toolbar: text color moved out of עוד menu to A-color button in main toolbar', () => {
  // The עוד menu now only has fill/number/borders
  assert.match(viewSource, /צבע רקע/);
  assert.match(viewSource, /פורמט מספר/);
  assert.match(viewSource, /גבולות/);
  // Text color is now via palette swatches (commitPresentationOrToolDefault) not a native color picker in more menu
  assert.match(viewSource, /commitPresentationOrToolDefault\(\{ color: swatch\.hex \}\)/);
  // The A-color control carries the text-color capability testid
  assert.match(viewSource, /data-testid="text-color-control"/);
  // More menu does NOT check text_color capability for a native color input
  assert.doesNotMatch(viewSource, /isCap\('text_color'\)[\s\S]{0,300}type="color"[\s\S]{0,100}fill_color/);
});

// ── View source: undo handles new entry kinds ─────────────────────────────────

test('view: undoLastAction handles column_visibility', () => {
  assert.match(viewSource, /entry\.kind === 'column_visibility'/);
  assert.match(viewSource, /previousHiddenKeys/);
  assert.match(viewSource, /persistHiddenColumns\(restored\)/);
});

test('view: undoLastAction handles column_width', () => {
  assert.match(viewSource, /entry\.kind === 'column_width'/);
  assert.match(viewSource, /entry\.previousWidth/);
  assert.match(viewSource, /saveClientOperationsColumnWidths.*entry\.columnKey.*entry\.previousWidth/s);
});

// ── View source: beginResize uses pure module ─────────────────────────────────

test('view: beginResize uses computeClientOperationsColumnResizeDelta (not manual arithmetic)', () => {
  assert.match(viewSource, /computeClientOperationsColumnResizeDelta\(\{/);
  assert.match(viewSource, /handleEdge: CLIENT_OPERATIONS_RESIZE_HANDLE_EDGE/);
  // Must NOT have the old manual arithmetic pattern
  assert.doesNotMatch(
    viewSource,
    /document\.dir === 'rtl' \? startX - moveEvent\.clientX : moveEvent\.clientX - startX/,
  );
});

test('view: beginResize pushes column_width undo entry on mouseup', () => {
  assert.match(viewSource, /kind: 'column_width'/);
  assert.match(viewSource, /previousWidth: startWidth/);
  assert.match(viewSource, /nextWidth: finalWidth/);
});

// ── View source: toggleHiddenColumn pushes undo entry ────────────────────────

test('view: toggleHiddenColumn pushes column_visibility undo entry', () => {
  assert.match(viewSource, /kind: 'column_visibility'/);
  assert.match(viewSource, /previousHiddenKeys: \[\.\.\.hiddenColumns\]/);
});

// ── View source: print function ───────────────────────────────────────────────

test('view: handlePrint opens window with landscape and RTL table', () => {
  assert.match(viewSource, /handlePrint/);
  assert.match(viewSource, /window\.open/);
  assert.match(viewSource, /size: landscape/);
  assert.match(viewSource, /direction: rtl/);
});

test('view: handlePrint uses selectPrintableColumnKeys from pure module', () => {
  assert.match(viewSource, /selectPrintableColumnKeys\(\{/);
  assert.match(viewSource, /columns: printColumns/);
  assert.match(viewSource, /rows: printRows/);
});

test('view: handlePrint includes print-safe status color classes', () => {
  assert.match(viewSource, /is-manual-status-\$\{statusToken\}/);
  assert.match(viewSource, /-webkit-print-color-adjust.*exact/s);
  assert.match(viewSource, /print-color-adjust.*exact/s);
});

// ── CSS: new classes present ─────────────────────────────────────────────────

test('CSS: font-size select class defined', () => {
  assert.match(cssSource, /\.nx-co-sheet__font-size-select/);
});

test('CSS: color-A button and palette classes defined', () => {
  assert.match(cssSource, /\.nx-co-sheet__color-a-btn/);
  assert.match(cssSource, /\.nx-co-sheet__color-a-letter/);
  assert.match(cssSource, /\.nx-co-sheet__color-palette/);
  assert.match(cssSource, /\.nx-co-sheet__color-swatch/);
});

test('CSS: column visibility popover defined', () => {
  assert.match(cssSource, /\.nx-co-sheet__col-visibility-popover/);
  assert.match(cssSource, /\.nx-co-sheet__col-visibility-item/);
});

test('CSS: resize handle has improved hover visibility via opacity', () => {
  assert.match(cssSource, /\.nx-co-sheet__resize-handle\s*\{[^}]*opacity:\s*0/s);
  assert.match(cssSource, /nx-co-sheet__resize-handle:hover/);
  assert.match(cssSource, /nx-co-sheet__table th:hover .nx-co-sheet__resize-handle/);
});

test('CSS: print media query with landscape and color-adjust', () => {
  assert.match(cssSource, /@media print/);
  assert.match(cssSource, /size: landscape/);
  assert.match(cssSource, /print-color-adjust/);
});
