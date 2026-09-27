import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLIENT_OPERATIONS_UNDO_MAX,
  CO_UNDO_EXCLUDED_ACTIONS,
  clearClientOperationsUndoStack,
  popClientOperationsUndoEntry,
  pushClientOperationsUndoEntry,
  type CoUndoEntry,
} from '../src/lib/client-operations-undo-stack.pure.js';

test('empty stack pop returns null', () => {
  const { entry, stack } = popClientOperationsUndoEntry([]);
  assert.equal(entry, null);
  assert.deepEqual(stack, []);
});

test('push respects max 10 and discards oldest', () => {
  let stack: CoUndoEntry[] = [];
  for (let i = 0; i < 11; i += 1) {
    stack = pushClientOperationsUndoEntry(stack, {
      kind: 'presentation',
      previous: { [`k${i}`]: { bold: true } },
    });
  }
  assert.equal(stack.length, CLIENT_OPERATIONS_UNDO_MAX);
  assert.equal(CLIENT_OPERATIONS_UNDO_MAX, 10);
  const first = stack[0] as Extract<CoUndoEntry, { kind: 'presentation' }>;
  assert.ok(first.previous.k1);
  assert.equal(first.previous.k0, undefined);
});

test('pop walks backwards one step', () => {
  let stack = pushClientOperationsUndoEntry([], {
    kind: 'manual_status',
    organizationId: 'org',
    periodKey: '2026-08',
    clientId: 'c1',
    columnKey: 'vat',
    previousStatus: null,
    newStatus: 'ready',
  });
  stack = pushClientOperationsUndoEntry(stack, {
    kind: 'manual_status',
    organizationId: 'org',
    periodKey: '2026-08',
    clientId: 'c1',
    columnKey: 'vat',
    previousStatus: 'ready',
    newStatus: 'completed',
  });
  const first = popClientOperationsUndoEntry(stack);
  assert.equal(first.entry?.kind, 'manual_status');
  if (first.entry?.kind === 'manual_status') {
    assert.equal(first.entry.newStatus, 'completed');
    assert.equal(first.entry.previousStatus, 'ready');
  }
  const second = popClientOperationsUndoEntry(first.stack);
  if (second.entry?.kind === 'manual_status') {
    assert.equal(second.entry.newStatus, 'ready');
  }
});

test('clear returns empty stack', () => {
  assert.deepEqual(clearClientOperationsUndoStack(), []);
});

test('excluded unsafe actions are documented', () => {
  assert.ok(CO_UNDO_EXCLUDED_ACTIONS.includes('operational_checkbox_toggle'));
  assert.ok(CO_UNDO_EXCLUDED_ACTIONS.includes('ni_deductions_102_100_126'));
  assert.ok(CO_UNDO_EXCLUDED_ACTIONS.includes('operational_target_date'));
});
