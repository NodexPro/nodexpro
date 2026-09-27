/**
 * Source-level contracts for Excel-like active-cell formatting selection.
 * Presentation-only — no backend command / API / persistence of selection.
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
const pureSource = readFileSync(
  join(dir, '../src/lib/client-operations-active-cell.pure.ts'),
  'utf8',
);
const presentationPersistSource = readFileSync(
  join(dir, '../src/lib/client-operations-cell-presentation.pure.ts'),
  'utf8',
);

// ── Pure module contracts ────────────────────────────────────────────────────

test('active-cell pure exports eligibility + reconcile helpers', () => {
  assert.match(pureSource, /export function isClientOperationsFormatEligibleColumn/);
  assert.match(pureSource, /export function reconcileActiveCellAfterColumnVisibility/);
  assert.match(pureSource, /export function reconcileActiveCellAfterRowsChange/);
  assert.match(pureSource, /export function shouldClearActiveCellOnPeriodChange/);
  assert.match(pureSource, /folder/);
});

test('active selection is presentation-only — no backend command / API / migration', () => {
  assert.doesNotMatch(pureSource, /fetch\(|onRegistryCommand|set_client_operations/);
  assert.doesNotMatch(pureSource, /localStorage|sessionStorage/);
  assert.match(viewSource, /selectActiveFormatCell/);
  assert.doesNotMatch(
    viewSource.slice(viewSource.indexOf('const selectActiveFormatCell'), viewSource.indexOf('const selectActiveFormatCell') + 500),
    /onRegistryCommand|fetch\(/,
  );
});

test('formatting persistence key unchanged (user+org scoped)', () => {
  assert.match(presentationPersistSource, /nx\.client-operations\.cell-presentation\.v1/);
  assert.match(presentationPersistSource, /userId.*organizationId|organizationId.*userId/s);
});

test('org switching clears selection on hydrate', () => {
  assert.match(viewSource, /widthScope\?\.organizationId, widthScope\?\.userId/);
  assert.match(viewSource, /loadClientOperationsCellPresentation[\s\S]{0,200}setFocusedCell\(null\)/s);
});

// ── Click → select active cell ───────────────────────────────────────────────

test('click normal cell: onMouseDown + onClick call selectActiveFormatCell', () => {
  assert.match(viewSource, /onMouseDown=\{\(event\) => \{/);
  assert.match(viewSource, /selectActiveFormatCell\(row\.client_id, column\)/);
  assert.match(
    viewSource,
    /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*if \(statusPaintMode\) return;\s*selectActiveFormatCell\(row\.client_id, column\)/s,
  );
});

test('selected cell gets visible Nova #123756 outline', () => {
  assert.match(cssSource, /--nx-co-brand:\s*#123756/);
  assert.match(cssSource, /\.nx-co-sheet__table td\.is-focused/);
  assert.match(cssSource, /\.nx-co-sheet__table td\.is-format-selected/);
  assert.match(cssSource, /outline:\s*1\.5px solid var\(--nx-co-brand\)/);
  assert.match(viewSource, /is-focused is-format-selected/);
  assert.match(viewSource, /data-format-selected=\{focused \? 'true' : 'false'\}/);
  assert.match(viewSource, /data-testid=\{focused \? 'co-active-format-cell'/);
});

test('formatting toolbar enabled only when focusedCell is set', () => {
  assert.match(viewSource, /const formatTargetActive = Boolean\(focusedCell\)/);
  assert.match(viewSource, /const formatDisabled = !formatTargetActive/);
  assert.match(viewSource, /disabled=\{!isCap\('bold'\) \|\| formatDisabled\}/);
  assert.match(viewSource, /disabled=\{!isCap\('italic'\) \|\| formatDisabled\}/);
  assert.match(viewSource, /disabled=\{!isCap\('underline'\) \|\| formatDisabled\}/);
  assert.match(viewSource, /disabled=\{!isCap\('align_right'\) \|\| formatDisabled\}/);
  assert.match(viewSource, /disabled=\{!isCap\('text_color'\) \|\| formatDisabled\}/);
  assert.match(viewSource, /disabled=\{formatDisabled\}/); // font-size
});

test('A / font size / B I U / alignment apply via applyPresentation on focusedCell', () => {
  assert.match(viewSource, /applyPresentation\(\{ bold: !cur \}\)/);
  assert.match(viewSource, /applyPresentation\(\{ italic: !cur \}\)/);
  assert.match(viewSource, /applyPresentation\(\{ underline: !cur \}\)/);
  assert.match(viewSource, /applyPresentation\(\{ align: 'right' \}\)/);
  assert.match(viewSource, /applyPresentation\(\{ align: 'center' \}\)/);
  assert.match(viewSource, /applyPresentation\(\{ align: 'left' \}\)/);
  assert.match(viewSource, /applyPresentation\(\{ color: swatch\.hex \}\)/);
  assert.match(viewSource, /applyPresentation\(\{\s*fontSize:/);
  assert.match(viewSource, /if \(!focusedCell\) return;/);
});

test('selection remains after toolbar action (mousedown preserve + no clear in applyPresentation)', () => {
  assert.match(viewSource, /preserveActiveCellOnToolbarMouseDown/);
  assert.match(viewSource, /onMouseDown=\{preserveActiveCellOnToolbarMouseDown\}/);
  const applyStart = viewSource.indexOf('const applyPresentation =');
  const applySlice = viewSource.slice(applyStart, applyStart + 700);
  assert.doesNotMatch(applySlice, /setFocusedCell\(null\)/);
});

test('clicking another cell moves selection via setFocusedCell identity', () => {
  assert.match(viewSource, /setFocusedCell\(\{ clientId, colKey: column\.key \}\)/);
});

test('Esc clears selection and related UI chrome', () => {
  assert.match(viewSource, /if \(event\.key !== 'Escape'\) return;/);
  assert.match(viewSource, /if \(focusedCell\) \{\s*setFocusedCell\(null\)/s);
});

// ── Interactive controls unchanged ───────────────────────────────────────────

test('checkbox behavior unchanged: onChange still toggles; selection is additive', () => {
  assert.match(viewSource, /void toggleMaterialStream\(r, stream\.key\)/);
  assert.match(viewSource, /void toggleNiDeductionsItem\(r, form\.key\)/);
  assert.match(viewSource, /void toggleIncomeTaxDeductions\(r\)/);
  assert.match(viewSource, /Presentation-only selection — does not change checkbox domain value/);
});

test('date behavior unchanged: setOperationalTargetDate on change; selection additive', () => {
  assert.match(viewSource, /void setOperationalTargetDate\(/);
  assert.match(viewSource, /tryShowNativeDatePicker/);
  assert.match(viewSource, /Presentation-only selection — does not change the date domain value/);
});

test('folder remains ineligible and still opens client modal', () => {
  assert.match(pureSource, /columnKey === 'folder' \|\| input\.cellKind === 'folder'/);
  assert.match(viewSource, /onClick=\{\(\) => openClientModal\(r\)\}/);
});

test('paint mode has priority — paint clicks do not set formatting selection', () => {
  assert.match(viewSource, /\/\/ Paint mode owns the gesture via capture click — do not turn into format selection\./);
  assert.match(viewSource, /Do NOT turn paint clicks into formatting selection/);
  const paintCaptureStart = viewSource.indexOf('onClickCapture={(event) => {');
  assert.ok(paintCaptureStart >= 0);
  const paintCapture = viewSource.slice(paintCaptureStart, paintCaptureStart + 900);
  assert.match(paintCapture, /if \(!statusPaintMode\) return;/);
  assert.match(paintCapture, /paintCellManualStatus\(row, column\.key\)/);
  assert.doesNotMatch(paintCapture, /setFocusedCell/);
});

// ── Custom cell editing / autosave intact ────────────────────────────────────

test('custom cell editing/autosave unchanged with selection', () => {
  assert.match(viewSource, /beginCustomCellEdit\(row, column\)/);
  assert.match(viewSource, /scheduleCustomCellAutosave/);
  assert.match(viewSource, /500/);
  assert.match(viewSource, /selectActiveFormatCell\(row\.client_id, column\);\s*if \(editingCellKeyRef\.current === pk\) return;/s);
});

// ── Clear / reconcile on period, org, hide, fullscreen ───────────────────────

test('period switching clears unsafe stale selection', () => {
  assert.match(viewSource, /shouldClearActiveCellOnPeriodChange\(\)/);
  assert.match(viewSource, /setFocusedCell\(null\)/);
  assert.match(viewSource, /flushDirtyBeforePeriodChange/);
});

test('hidden selected column reconciles/clears selection', () => {
  assert.match(viewSource, /reconcileActiveCellAfterColumnVisibility/);
  assert.match(viewSource, /hiddenColumnKeys: hiddenColumns/);
});

test('fullscreen does not clear focusedCell on toggle', () => {
  assert.match(viewSource, /onClick=\{\(\) => setFullscreenOpen\(\(open\) => !open\)\}/);
  const fsToggle = viewSource.match(/setFullscreenOpen\(\(open\) => !open\)/);
  assert.ok(fsToggle);
  // Entering fullscreen must not wipe selection in the same handler.
  const idx = viewSource.indexOf('setFullscreenOpen((open) => !open)');
  const nearby = viewSource.slice(idx - 120, idx + 80);
  assert.doesNotMatch(nearby, /setFocusedCell\(null\)/);
});
