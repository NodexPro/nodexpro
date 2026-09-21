import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampClientOperationsColumnWidth,
  clientOperationsColumnWidthsStorageKey,
  loadClientOperationsColumnWidths,
  saveClientOperationsColumnWidths,
} from '../src/lib/client-operations-column-widths.pure.js';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

test('column widths are scoped to user and organization', () => {
  assert.equal(
    clientOperationsColumnWidthsStorageKey('user-a', 'org-a'),
    'nx.client-operations.column-widths.v1:user-a:org-a',
  );
  assert.notEqual(
    clientOperationsColumnWidthsStorageKey('user-a', 'org-a'),
    clientOperationsColumnWidthsStorageKey('user-b', 'org-a'),
  );
});

test('column widths clamp and contain widths only', () => {
  const storage = memoryStorage();
  saveClientOperationsColumnWidths('user', 'org', { client_name: 12, custom_due: 999 }, storage);
  assert.deepEqual(loadClientOperationsColumnWidths('user', 'org', storage), {
    client_name: 48,
    custom_due: 480,
  });
  assert.equal(clampClientOperationsColumnWidth(140.7), 141);
});
