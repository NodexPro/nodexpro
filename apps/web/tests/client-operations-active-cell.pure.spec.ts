/**
 * Active-cell formatting selection — pure helpers (presentation only).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isClientOperationsFormatEligibleColumn,
  reconcileActiveCellAfterColumnVisibility,
  reconcileActiveCellAfterRowsChange,
  shouldClearActiveCellOnPeriodChange,
} from '../src/lib/client-operations-active-cell.pure.js';

test('normal format-capable column is eligible', () => {
  assert.equal(isClientOperationsFormatEligibleColumn({ columnKey: 'vat', cellKind: 'text' }), true);
  assert.equal(isClientOperationsFormatEligibleColumn({ columnKey: 'client_name', cellKind: 'text' }), true);
  assert.equal(isClientOperationsFormatEligibleColumn({ columnKey: 'notes', cellKind: 'notes' }), true);
  assert.equal(isClientOperationsFormatEligibleColumn({ columnKey: 'custom_1', cellKind: 'custom' }), true);
  assert.equal(
    isClientOperationsFormatEligibleColumn({ columnKey: 'material_brought', cellKind: 'checkbox' }),
    true,
  );
  assert.equal(
    isClientOperationsFormatEligibleColumn({ columnKey: 'annual_report', cellKind: 'operational_date' }),
    true,
  );
});

test('folder column is not format-eligible', () => {
  assert.equal(isClientOperationsFormatEligibleColumn({ columnKey: 'folder', cellKind: 'folder' }), false);
  assert.equal(isClientOperationsFormatEligibleColumn({ columnKey: 'folder', cellKind: 'text' }), false);
  assert.equal(isClientOperationsFormatEligibleColumn({ columnKey: 'other', cellKind: 'folder' }), false);
});

test('empty column key is not eligible', () => {
  assert.equal(isClientOperationsFormatEligibleColumn({ columnKey: '', cellKind: 'text' }), false);
});

test('period change must clear unsafe stale selection', () => {
  assert.equal(shouldClearActiveCellOnPeriodChange(), true);
});

test('hiding selected column clears active cell', () => {
  const active = { clientId: 'c1', colKey: 'vat' };
  assert.equal(
    reconcileActiveCellAfterColumnVisibility({
      active,
      hiddenColumnKeys: ['vat'],
    }),
    null,
  );
});

test('hiding other column keeps active cell', () => {
  const active = { clientId: 'c1', colKey: 'vat' };
  assert.deepEqual(
    reconcileActiveCellAfterColumnVisibility({
      active,
      hiddenColumnKeys: ['payroll'],
    }),
    active,
  );
});

test('null active stays null after visibility reconcile', () => {
  assert.equal(
    reconcileActiveCellAfterColumnVisibility({
      active: null,
      hiddenColumnKeys: ['vat'],
    }),
    null,
  );
});

test('rows change clears selection when client disappears', () => {
  assert.equal(
    reconcileActiveCellAfterRowsChange({
      active: { clientId: 'c1', colKey: 'vat' },
      clientIds: ['c2', 'c3'],
    }),
    null,
  );
});

test('rows change keeps selection when client remains', () => {
  const active = { clientId: 'c1', colKey: 'vat' };
  assert.deepEqual(
    reconcileActiveCellAfterRowsChange({
      active,
      clientIds: ['c2', 'c1'],
    }),
    active,
  );
});
