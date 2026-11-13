import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  beginOptimisticCheckbox,
  canStartOptimisticCheckboxCommand,
  checkboxOptimisticMarkKey,
  dropOptimisticCheckboxesForOtherPeriod,
  reconcileOptimisticCheckboxWithAggregate,
  resolveOptimisticCheckboxChecked,
  revertOptimisticCheckbox,
  shouldClearOptimisticCheckboxAfterSuccess,
} from '../src/lib/client-operations-checkbox-optimistic.pure';

const dir = dirname(fileURLToPath(import.meta.url));
const view = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const css = readFileSync(join(dir, '../src/styles/nx-client-operations-spreadsheet.css'), 'utf8');
const premium = readFileSync(join(dir, '../src/styles/nx-premium-check.css'), 'utf8');

function markMap() {
  return new Map();
}

test('immediate visual feedback uses optimistic overlay before aggregate flips', () => {
  const markKey = checkboxOptimisticMarkKey('c1', 'material:vat', '2026-11');
  const map = markMap();
  const entry = beginOptimisticCheckbox(map, { markKey, periodKey: '2026-11', value: true });
  assert.ok(entry);
  assert.equal(
    resolveOptimisticCheckboxChecked({
      aggregateChecked: false,
      entry,
      viewedPeriodKey: '2026-11',
    }),
    true,
  );
  assert.match(view, /beginOptimisticCheckbox/);
  assert.match(view, /setOptimisticChecks\(new Map\(optimisticChecksRef\.current\)\)/);
  const optimisticIdx = view.indexOf('beginOptimisticCheckbox');
  const awaitIdx = view.indexOf('await onRegistryCommand', optimisticIdx);
  assert.ok(optimisticIdx >= 0 && awaitIdx > optimisticIdx);
});

test('successful save clears overlay so returned aggregate is the displayed truth', () => {
  const markKey = checkboxOptimisticMarkKey('c1', 'material:vat', '2026-11');
  const map = markMap();
  const entry = beginOptimisticCheckbox(map, { markKey, periodKey: '2026-11', value: true });
  assert.equal(
    shouldClearOptimisticCheckboxAfterSuccess({ entry: map.get(markKey), seq: entry!.seq }),
    true,
  );
  map.delete(markKey);
  assert.equal(
    resolveOptimisticCheckboxChecked({
      aggregateChecked: true,
      entry: map.get(markKey),
      viewedPeriodKey: '2026-11',
    }),
    true,
  );
  assert.match(view, /shouldClearOptimisticCheckboxAfterSuccess/);
});

test('rollback on failure restores the previous aggregate checkbox', () => {
  const markKey = checkboxOptimisticMarkKey('c1', 'material:vat', '2026-11');
  const map = markMap();
  const entry = beginOptimisticCheckbox(map, { markKey, periodKey: '2026-11', value: true });
  assert.equal(revertOptimisticCheckbox(map, markKey, entry!.seq), true);
  assert.equal(
    resolveOptimisticCheckboxChecked({
      aggregateChecked: false,
      entry: map.get(markKey),
      viewedPeriodKey: '2026-11',
    }),
    false,
  );
  assert.match(view, /revertOptimisticCheckbox/);
  assert.match(view, /setCommandError\(localizeRegistryCommandError/);
});

test('rapid clicks do not start a second command or invert the optimistic value', () => {
  const markKey = checkboxOptimisticMarkKey('c1', 'material:vat', '2026-11');
  const pending = new Set([markKey]);
  assert.equal(canStartOptimisticCheckboxCommand(pending, markKey), false);
  assert.equal(canStartOptimisticCheckboxCommand(new Set(), markKey), true);
  assert.match(view, /canStartOptimisticCheckboxCommand\(pendingMarkKeysRef\.current, markKey\)/);
  assert.match(view, /if \(pendingMarkKeysRef\.current\.has\(markKey\)\) return/);
});

test('month switching never paints another period\'s optimistic checkbox', () => {
  const markKey = checkboxOptimisticMarkKey('c1', 'material:vat', '2026-10');
  const map = markMap();
  beginOptimisticCheckbox(map, { markKey, periodKey: '2026-10', value: true });
  assert.equal(
    resolveOptimisticCheckboxChecked({
      aggregateChecked: false,
      entry: map.get(markKey),
      viewedPeriodKey: '2026-11',
    }),
    false,
  );
  assert.equal(dropOptimisticCheckboxesForOtherPeriod(map, '2026-11'), true);
  assert.equal(map.size, 0);
  assert.match(view, /dropOptimisticCheckboxesForOtherPeriod/);
  assert.match(view, /flushDirtyBeforePeriodChange/);
});

test('server reconciliation keeps overlay only while its seq and period still match', () => {
  const markKey = checkboxOptimisticMarkKey('c1', 'material:vat', '2026-11');
  const map = markMap();
  const first = beginOptimisticCheckbox(map, { markKey, periodKey: '2026-11', value: true });
  const second = beginOptimisticCheckbox(map, { markKey, periodKey: '2026-11', value: false });
  assert.equal(
    shouldClearOptimisticCheckboxAfterSuccess({ entry: map.get(markKey), seq: first!.seq }),
    false,
  );
  assert.equal(
    shouldClearOptimisticCheckboxAfterSuccess({ entry: map.get(markKey), seq: second!.seq }),
    true,
  );
  assert.equal(
    reconcileOptimisticCheckboxWithAggregate({
      entry: map.get(markKey),
      viewedPeriodKey: '2026-11',
      aggregateChecked: false,
    }),
    'use-optimistic',
  );
  assert.equal(
    reconcileOptimisticCheckboxWithAggregate({
      entry: map.get(markKey),
      viewedPeriodKey: '2026-12',
      aggregateChecked: false,
    }),
    'use-aggregate',
  );
  assert.match(view, /onInvalidateStaleLoads\?\.\(\)/);
});

test('VAT / income-tax / payroll material checkboxes share the optimistic overlay', () => {
  assert.match(view, /checkboxOptimisticMarkKey\(row\.client_id, `material:\$\{stream\}`/);
  assert.match(view, /checkboxOptimisticMarkKey\(r\.client_id, `material:\$\{stream\.key\}`/);
  assert.match(view, /set_income_tax_advance_material_brought/);
  assert.match(view, /set_payroll_material_brought/);
});

test('checked material checkbox is a solid fill without native tick, gradient or ::after stripe', () => {
  assert.match(
    css,
    /\.nx-co-sheet__material-slot \.nx-co-sheet__checkbox:checked[\s\S]*background-color:\s*#268cff/,
  );
  assert.match(
    css,
    /\.nx-co-sheet__material-slot \.nx-co-sheet__checkbox:checked::after[\s\S]*content:\s*none/,
  );
  assert.match(
    css,
    /\.nx-co-sheet__material-slot \.nx-co-sheet__checkbox:checked[\s\S]*background-image:\s*none/,
  );
  assert.match(css, /\.nx-co-sheet__material-slot \.nx-co-sheet__checkbox:focus-visible/);
  assert.doesNotMatch(
    css,
    /\.nx-co-sheet__material-slot \.nx-co-sheet__checkbox:checked[^{]*\{[^}]*linear-gradient/,
  );
  assert.match(premium, /appearance:\s*none/);
});
