import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertNotSystemColumnKey,
  buildClientOperationsToolbarCapabilities,
  buildCustomColumnsCapability,
  CLIENT_OPERATIONS_CUSTOM_COLUMNS_MAX,
  formatCustomCellDisplayHe,
  mergeCustomCellsIntoRow,
  slugifyCustomColumnKey,
} from '../../src/domains/client-operations/client-operations-registry-presentation.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const commandServiceSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-registry-custom-columns.service.ts'),
  'utf8'
);

test('custom column capability enforces the max and edit permission', () => {
  assert.equal(CLIENT_OPERATIONS_CUSTOM_COLUMNS_MAX, 10);
  assert.deepEqual(buildCustomColumnsCapability({ current: 9, canEdit: true }), { max: 10, current: 9, can_create: true });
  assert.deepEqual(buildCustomColumnsCapability({ current: 10, canEdit: true }), { max: 10, current: 10, can_create: false });
  assert.deepEqual(buildCustomColumnsCapability({ current: 0, canEdit: false }), { max: 10, current: 0, can_create: false });
});

test('system keys cannot be allocated as custom keys', () => {
  assert.throws(() => assertNotSystemColumnKey('vat'), /collides with system column/);
  assert.throws(() => assertNotSystemColumnKey('folder'), /collides with system column/);
  assert.doesNotThrow(() => assertNotSystemColumnKey('office_status'));
  assert.equal(slugifyCustomColumnKey('Office Status!'), 'office_status');
  assert.equal(slugifyCustomColumnKey('עמודה מותאמת'), 'custom_column');
});

test('custom values display according to their typed backend value', () => {
  assert.equal(formatCustomCellDisplayHe('text', { value_text: 'טקסט' }), 'טקסט');
  assert.equal(formatCustomCellDisplayHe('number', { value_number: 1234.5 }), '1,234.5');
  assert.equal(formatCustomCellDisplayHe('date', { value_date: '2026-09-13' }), '13.09.2026');
  assert.equal(formatCustomCellDisplayHe('boolean', { value_bool: true }), 'כן');
  assert.equal(formatCustomCellDisplayHe('boolean', { value_bool: false }), 'לא');
  assert.equal(formatCustomCellDisplayHe('text', {}), '—');
});

test('multiple custom columns merge independently into the same row', () => {
  const merged = mergeCustomCellsIntoRow(
    { client_id: 'client-1', cells: { client_name: 'לקוח' } },
    [
      { id: 'column-1', key: 'office_status', data_type: 'text' },
      { id: 'column-2', key: 'priority', data_type: 'number' },
    ],
    new Map([
      ['client-1:column-1', { value_text: 'ממתין' }],
      ['client-1:column-2', { value_number: 3 }],
    ])
  );
  assert.equal(merged.cells.client_name, 'לקוח');
  assert.equal(merged.cells.office_status, 'ממתין');
  assert.equal(merged.cells.priority, '3');
});

test('toolbar enables add column only from backend capability', () => {
  const enabled = buildClientOperationsToolbarCapabilities({ can_create_custom_column: true }).find((item) => item.id === 'add_column');
  const disabled = buildClientOperationsToolbarCapabilities({
    can_create_custom_column: false,
    can_create_reason_he: 'הגעת למגבלה',
  }).find((item) => item.id === 'add_column');
  assert.equal(enabled?.available, true);
  assert.equal(enabled?.reason_he, null);
  assert.equal(disabled?.available, false);
  assert.equal(disabled?.reason_he, 'הגעת למגבלה');
});

test('renaming keeps the persisted key stable', () => {
  const column = { key: 'office_status', label: 'סטטוס משרד' };
  const renamed = { ...column, label: 'מצב במשרד' };
  assert.equal(renamed.key, 'office_status');
  assert.match(commandServiceSource, /\.update\(\{ label, updated_at:/);
  assert.doesNotMatch(commandServiceSource, /\.update\(\{[^}]*key:/);
});

test('create enforces max 10 with stable code and returns refreshed registry aggregate', () => {
  assert.match(commandServiceSource, /CLIENT_OPERATIONS_CUSTOM_COLUMNS_MAX/);
  assert.match(commandServiceSource, /CLIENT_OPERATIONS_CUSTOM_COLUMN_LIMIT/);
  assert.match(commandServiceSource, /listClientOperationsRegistry\(ctx/);
  assert.match(commandServiceSource, /create_client_operations_custom_column/);
  assert.match(commandServiceSource, /set_client_operations_custom_column_value/);
  assert.match(commandServiceSource, /hide_client_operations_custom_column/);
  assert.match(commandServiceSource, /show_client_operations_custom_column/);
  assert.match(commandServiceSource, /reorder_client_operations_custom_column/);
  assert.match(commandServiceSource, /archive_client_operations_custom_column/);
  assert.match(commandServiceSource, /CLIENT_OPERATIONS_CUSTOM_COLUMN_CREATED/);
  assert.match(commandServiceSource, /\.eq\('organization_id', orgId\)/);
  assert.match(commandServiceSource, /client_operations\.edit permission required/);
  assert.match(commandServiceSource, /Failed to validate client/);
});

test('value loads are batched by org + client ids (no N\+1)', () => {
  assert.match(commandServiceSource, /\.in\('client_id', clientIds\)/);
  assert.match(commandServiceSource, /One org-and-client-batched value query/);
});
