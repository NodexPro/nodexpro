import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
const viewSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const cssSource = readFileSync(join(dir, '../src/styles/nx-client-operations-spreadsheet.css'), 'utf8');
const reconcileSource = readFileSync(
  join(dir, '../src/lib/client-operations-manual-status-reconcile.pure.ts'),
  'utf8',
);
const undoSource = readFileSync(join(dir, '../src/lib/client-operations-undo-stack.pure.ts'), 'utf8');

test('search: no visible חפש text button; magnifier inside field', () => {
  assert.match(viewSource, /nx-co-sheet__search-field/);
  assert.match(viewSource, /nx-co-sheet__search-icon/);
  assert.doesNotMatch(viewSource, />\s*חפש\s*</);
  assert.match(viewSource, /applyLiveSearch\(searchDraft\)/);
  assert.match(viewSource, /event\.key === 'Enter'/);
});

test('toolbar: redo and wrap hidden; alignment icons present', () => {
  assert.match(viewSource, /hidden[\s\S]*בצע שוב/);
  assert.match(viewSource, /hidden[\s\S]*גלישה/);
  assert.doesNotMatch(viewSource, />\s*יישור ימין\s*</);
  assert.doesNotMatch(viewSource, />\s*מרכז\s*</);
  assert.doesNotMatch(viewSource, />\s*יישור שמאל\s*</);
  assert.match(viewSource, /aria-label="יישור ימין"/);
  assert.match(viewSource, /aria-label="מרכז"/);
  assert.match(viewSource, /aria-label="יישור שמאל"/);
  assert.match(viewSource, /nx-co-sheet__btn--icon/);
});

test('undo: icon-only real stack max 10 via named inverse paths', () => {
  assert.match(viewSource, /aria-label="בטל"/);
  assert.doesNotMatch(viewSource, />\s*בטל\s*</);
  assert.match(viewSource, /undoLastAction/);
  assert.match(viewSource, /pushClientOperationsUndoEntry/);
  assert.match(viewSource, /restoreManualStatusFromUndo/);
  assert.match(viewSource, /set_client_operations_cell_manual_status/);
  assert.match(viewSource, /set_client_operations_custom_column_value/);
  assert.match(undoSource, /CLIENT_OPERATIONS_UNDO_MAX = 10/);
  assert.match(undoSource, /CO_UNDO_EXCLUDED_ACTIONS/);
});

test('fullscreen: true viewport workspace class + esc exit', () => {
  assert.match(viewSource, /nx-co-sheet--app-fullscreen/);
  assert.match(viewSource, /data-fullscreen=\{fullscreenOpen \? 'true' : 'false'\}/);
  assert.match(viewSource, /setFullscreenOpen\(\(open\) => !open\)/);
  assert.match(viewSource, /event\.key === 'Escape'/);
  assert.match(cssSource, /\.nx-co-sheet--app-fullscreen\s*\{[^}]*inset:\s*0/s);
  assert.match(cssSource, /100dvh|100vw/);
  assert.match(cssSource, /\.nx-co-sheet--app-fullscreen \.nx-co-sheet__canvas/);
  assert.match(cssSource, /\.nx-co-sheet--app-fullscreen \.nx-co-sheet__period-tabs/);
  assert.doesNotMatch(viewSource, /nx-co-sheet__fullscreen" role="dialog"/);
});

test('color race: overlays + invalidate stale loads + no deferred cache poison', () => {
  assert.match(reconcileSource, /reconcileManualStatusRows/);
  assert.match(viewSource, /statusOverlaysRef/);
  assert.match(viewSource, /applyAggregateReconciled/);
  assert.match(viewSource, /onInvalidateStaleLoads/);
  assert.match(pageSource, /invalidateStaleLoads/);
  assert.match(pageSource, /loadSeqRef\.current \+= 1/);
  assert.match(pageSource, /Do NOT cache/);
  assert.doesNotMatch(
    pageSource,
    /applyAggregate !== false\)[\s\S]*putPeriodAggregateCache[\s\S]*responsePeriod\) putPeriodAggregateCache/,
  );
});

test('org change clears undo + overlays', () => {
  assert.match(viewSource, /clearManualStatusOverlays/);
  assert.match(viewSource, /clearClientOperationsUndoStack/);
  assert.match(viewSource, /widthScope\?\.organizationId/);
});
