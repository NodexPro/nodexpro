/**
 * Formatting toolbar must always look active — not gated on focusedCell.
 * Cell mutation still requires an active cell (tool defaults otherwise).
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
const presentationPersistSource = readFileSync(
  join(dir, '../src/lib/client-operations-cell-presentation.pure.ts'),
  'utf8',
);

function sliceAround(marker: string, before = 80, after = 420): string {
  const idx = viewSource.indexOf(marker);
  assert.ok(idx >= 0, `missing marker: ${marker}`);
  return viewSource.slice(Math.max(0, idx - before), idx + after);
}

test('1 page loads with no active cell — formatDisabled / focusedCell gate removed', () => {
  assert.doesNotMatch(viewSource, /formatDisabled/);
  assert.doesNotMatch(viewSource, /formatTargetActive/);
  assert.match(viewSource, /presentationToolDefaults/);
  assert.match(viewSource, /commitPresentationOrToolDefault/);
});

test('2 A enabled without focusedCell gate', () => {
  const slice = sliceAround('data-testid="text-color-control"');
  assert.match(slice, /disabled=\{!isCap\('text_color'\)\}/);
  assert.doesNotMatch(slice, /focusedCell|formatDisabled/);
});

test('3 font size enabled without focusedCell gate', () => {
  const slice = sliceAround('data-testid="font-size-control"');
  assert.doesNotMatch(slice, /disabled=\{/);
  assert.doesNotMatch(slice, /formatDisabled|!focusedCell/);
});

test('4-6 B I U enabled without focusedCell gate', () => {
  assert.match(viewSource, /disabled=\{!isCap\('bold'\)\}/);
  assert.match(viewSource, /disabled=\{!isCap\('italic'\)\}/);
  assert.match(viewSource, /disabled=\{!isCap\('underline'\)\}/);
  assert.doesNotMatch(viewSource, /disabled=\{!isCap\('bold'\) \|\|/);
  assert.doesNotMatch(viewSource, /disabled=\{!isCap\('italic'\) \|\|/);
  assert.doesNotMatch(viewSource, /disabled=\{!isCap\('underline'\) \|\|/);
});

test('7-9 alignment enabled without focusedCell gate', () => {
  assert.match(viewSource, /disabled=\{!isCap\('align_right'\)\}/);
  assert.match(viewSource, /disabled=\{!isCap\('align_center'\)\}/);
  assert.match(viewSource, /disabled=\{!isCap\('align_left'\)\}/);
  assert.doesNotMatch(viewSource, /disabled=\{!isCap\('align_right'\) \|\|/);
  assert.doesNotMatch(viewSource, /disabled=\{!isCap\('align_center'\) \|\|/);
  assert.doesNotMatch(viewSource, /disabled=\{!isCap\('align_left'\) \|\|/);
});

test('10 hide/show columns enabled (no focusedCell dependency)', () => {
  const slice = sliceAround('data-testid="column-visibility-control"');
  assert.doesNotMatch(slice, /disabled=/);
  assert.doesNotMatch(slice, /focusedCell/);
});

test('11 print enabled (no focusedCell dependency)', () => {
  const slice = sliceAround('data-testid="print-control"');
  assert.doesNotMatch(slice, /disabled=/);
  assert.doesNotMatch(slice, /focusedCell/);
});

test('12 fullscreen enabled without active-cell gate', () => {
  assert.match(viewSource, /disabled=\{capById\.has\('fullscreen'\) && !isCap\('fullscreen'\)\}/);
  const fsIdx = viewSource.indexOf("capById.has('fullscreen') && !isCap('fullscreen')");
  assert.ok(fsIdx >= 0);
  const nearby = viewSource.slice(fsIdx - 200, fsIdx + 200);
  assert.doesNotMatch(nearby, /focusedCell/);
});

test('13-15 no active cell: tool defaults only — no cellPresentation / domain mutation', () => {
  const helperStart = viewSource.indexOf('const commitPresentationOrToolDefault');
  assert.ok(helperStart >= 0);
  const helper = viewSource.slice(helperStart, helperStart + 900);
  assert.match(helper, /setPresentationToolDefaults/);
  assert.match(helper, /if \(!focusedCell\) return;/);
  assert.match(helper, /applyPresentation\(patch\)/);
  // applyPresentation itself never writes without focusedCell
  const applyStart = viewSource.indexOf('const applyPresentation =');
  const apply = viewSource.slice(applyStart, applyStart + 200);
  assert.match(apply, /if \(!focusedCell\) return;/);
  assert.doesNotMatch(helper, /onRegistryCommand|toggleMaterial|setOperational/);
});

test('16-18 active cell: formatting still applies, selection retained, persistence retained', () => {
  assert.match(viewSource, /commitPresentationOrToolDefault/);
  assert.match(viewSource, /applyPresentation\(patch\)/);
  assert.match(viewSource, /persistCellPresentation\(next\)/);
  assert.match(viewSource, /preserveActiveCellOnToolbarMouseDown/);
  const applyStart = viewSource.indexOf('const applyPresentation =');
  const apply = viewSource.slice(applyStart, applyStart + 700);
  assert.doesNotMatch(apply, /setFocusedCell\(null\)/);
  assert.match(presentationPersistSource, /nx\.client-operations\.cell-presentation\.v1/);
});

test('19-20 Undo correctly conditional on stack', () => {
  assert.match(viewSource, /disabled=\{!isCap\('undo'\) \|\| coUndoStack\.length === 0\}/);
});

test('21-26 regressions: paint / checkbox / date / custom / period / fullscreen intact', () => {
  assert.match(viewSource, /paintCellManualStatus\(row, column\.key\)/);
  assert.match(viewSource, /Do NOT turn paint clicks into formatting selection/);
  assert.match(viewSource, /void toggleMaterialStream/);
  assert.match(viewSource, /void setOperationalTargetDate/);
  assert.match(viewSource, /scheduleCustomCellAutosave/);
  assert.match(viewSource, /shouldClearActiveCellOnPeriodChange/);
  assert.match(viewSource, /setFullscreenOpen\(\(open\) => !open\)/);
});
