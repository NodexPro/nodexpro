import assert from 'node:assert/strict';
import test from 'node:test';
import {
  listClientOperationsExcelEditableCells,
  nextClientOperationsExcelEditableCell,
} from '../src/lib/client-operations-excel-nav.pure.js';

test('Tab order walks custom cells then editable manual cells', () => {
  const cells = listClientOperationsExcelEditableCells({
    clientRows: [{ client_id: 'c1' }, { client_id: 'c2' }],
    manualRows: [
      {
        row_key: 'm1',
        cell_presentation: {
          user_slot_01: { cell_kind: 'manual_text', editable: true },
          folder: { cell_kind: 'folder', editable: false },
        },
      },
    ],
    columns: [
      { key: 'client_name', cell_kind: 'text', editable: false },
      { key: 'user_slot_01', cell_kind: 'custom', editable: true },
      { key: 'user_slot_02', cell_kind: 'custom', editable: true },
    ],
  });
  assert.deepEqual(cells, [
    { rowKind: 'client', rowId: 'c1', columnKey: 'user_slot_01' },
    { rowKind: 'client', rowId: 'c1', columnKey: 'user_slot_02' },
    { rowKind: 'client', rowId: 'c2', columnKey: 'user_slot_01' },
    { rowKind: 'client', rowId: 'c2', columnKey: 'user_slot_02' },
    { rowKind: 'manual', rowId: 'm1', columnKey: 'user_slot_01' },
  ]);
  assert.deepEqual(
    nextClientOperationsExcelEditableCell({
      current: { rowKind: 'client', rowId: 'c1', columnKey: 'user_slot_02' },
      cells,
    }),
    { rowKind: 'client', rowId: 'c2', columnKey: 'user_slot_01' },
  );
  assert.equal(
    nextClientOperationsExcelEditableCell({
      current: { rowKind: 'manual', rowId: 'm1', columnKey: 'user_slot_01' },
      cells,
    }),
    null,
  );
});
