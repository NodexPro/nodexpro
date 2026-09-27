import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completeManualStatusPaintSuccess,
  rememberManualStatusPaintIntent,
  tryStartManualStatusPaint,
  type ManualStatusPaintSlot,
} from '../src/lib/client-operations-manual-status-paint.pure.js';
import {
  clearManualStatusOverlays,
  manualStatusPaintKey,
  mergeRowsWithManualStatusOverlays,
  pruneOverlaysMatchingAggregate,
  reconcileManualStatusRows,
  setManualStatusOverlay,
  type ManualStatusCapableRow,
  type ManualStatusOverlay,
} from '../src/lib/client-operations-manual-status-reconcile.pure.js';

function row(
  clientId: string,
  columnKey: string,
  status: 'ready' | 'sent_for_approval' | 'completed' | null,
): ManualStatusCapableRow {
  return {
    client_id: clientId,
    manual_cell_statuses: {
      [columnKey]: {
        status,
        presentation_token: status,
        allowed_statuses: ['ready', 'sent_for_approval', 'completed', 'clear'],
        operational_square_count: 0,
      },
    },
  };
}

test('old quiet aggregate cannot remove newer optimistic ready', () => {
  const overlays = new Map<string, ManualStatusOverlay>();
  const slots = new Map<string, ManualStatusPaintSlot>();
  const key = manualStatusPaintKey('c1', 'vat', '2026-08');
  rememberManualStatusPaintIntent(slots, key, 'ready');
  assert.ok(tryStartManualStatusPaint(slots, key));
  setManualStatusOverlay(overlays, key, 'ready', 1);

  const stale = [row('c1', 'vat', null)];
  const merged = reconcileManualStatusRows({
    rows: stale,
    overlays,
    slots,
    viewedPeriodKey: '2026-08',
  });
  assert.equal(merged[0]?.manual_cell_statuses?.vat?.status, 'ready');
  assert.equal(overlays.has(key), true);
});

test('old quiet aggregate cannot remove confirmed ready when overlay still present', () => {
  const overlays = new Map<string, ManualStatusOverlay>();
  const slots = new Map<string, ManualStatusPaintSlot>();
  const key = manualStatusPaintKey('c1', 'pcn', '2026-08');
  setManualStatusOverlay(overlays, key, 'ready', 2);

  const stale = [row('c1', 'pcn', null)];
  const merged = reconcileManualStatusRows({
    rows: stale,
    overlays,
    slots,
    viewedPeriodKey: '2026-08',
  });
  assert.equal(merged[0]?.manual_cell_statuses?.pcn?.status, 'ready');
});

test('yellow → green latest wins visually against older yellow aggregate', () => {
  const overlays = new Map<string, ManualStatusOverlay>();
  const slots = new Map<string, ManualStatusPaintSlot>();
  const key = manualStatusPaintKey('c1', 'payroll', '2026-08');
  rememberManualStatusPaintIntent(slots, key, 'completed');
  assert.ok(tryStartManualStatusPaint(slots, key));
  setManualStatusOverlay(overlays, key, 'completed', 3);

  const olderYellow = [row('c1', 'payroll', 'ready')];
  const merged = reconcileManualStatusRows({
    rows: olderYellow,
    overlays,
    slots,
    viewedPeriodKey: '2026-08',
  });
  assert.equal(merged[0]?.manual_cell_statuses?.payroll?.status, 'completed');
});

test('matching aggregate prunes overlay only when paint slot is idle', () => {
  const overlays = new Map<string, ManualStatusOverlay>();
  const slots = new Map<string, ManualStatusPaintSlot>();
  const key = manualStatusPaintKey('c1', 'notes', '2026-08');
  setManualStatusOverlay(overlays, key, 'ready', 4);
  pruneOverlaysMatchingAggregate(overlays, [row('c1', 'notes', 'ready')], '2026-08', slots);
  assert.equal(overlays.has(key), false);
});

test('period cache style older status for another period does not clobber viewed overlays', () => {
  const overlays = new Map<string, ManualStatusOverlay>();
  setManualStatusOverlay(overlays, manualStatusPaintKey('c1', 'vat', '2026-08'), 'ready', 5);
  setManualStatusOverlay(overlays, manualStatusPaintKey('c1', 'vat', '2026-09'), 'completed', 6);

  const rowsSep = [row('c1', 'vat', null)];
  const viewedSep = mergeRowsWithManualStatusOverlays(rowsSep, overlays, '2026-09');
  assert.equal(viewedSep[0]?.manual_cell_statuses?.vat?.status, 'completed');

  const rowsAug = [row('c1', 'vat', null)];
  const viewedAug = mergeRowsWithManualStatusOverlays(rowsAug, overlays, '2026-08');
  assert.equal(viewedAug[0]?.manual_cell_statuses?.vat?.status, 'ready');
});

test('clearManualStatusOverlays empties map', () => {
  const overlays = new Map<string, ManualStatusOverlay>();
  setManualStatusOverlay(overlays, 'a:b:c', 'ready', 1);
  clearManualStatusOverlays(overlays);
  assert.equal(overlays.size, 0);
});

test('same-cell yellow→green: intermediate aggregate apply skipped while newer pending', () => {
  const slots = new Map<string, ManualStatusPaintSlot>();
  const key = manualStatusPaintKey('c1', 'vat', '2026-08');
  rememberManualStatusPaintIntent(slots, key, 'ready');
  assert.ok(tryStartManualStatusPaint(slots, key));
  rememberManualStatusPaintIntent(slots, key, 'completed');
  const mid = completeManualStatusPaintSuccess(slots, key, 'ready');
  assert.equal(mid.applyAggregateRecommended, false);
  assert.deepEqual(mid.startNext, { key, status: 'completed' });
});
