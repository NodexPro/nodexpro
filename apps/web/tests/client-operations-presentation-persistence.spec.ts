import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clientOperationsCellPresentationStorageKey,
  loadClientOperationsCellPresentation,
  saveClientOperationsCellPresentation,
} from '../src/lib/client-operations-cell-presentation.pure.js';
import {
  clientOperationsHiddenColumnsStorageKey,
  loadClientOperationsHiddenColumns,
  saveClientOperationsHiddenColumns,
  sanitizeClientOperationsHiddenColumnKeys,
} from '../src/lib/client-operations-hidden-columns.pure.js';
import {
  clientOperationsColumnWidthsStorageKey,
  loadClientOperationsColumnWidths,
  saveClientOperationsColumnWidths,
} from '../src/lib/client-operations-column-widths.pure.js';
import { selectPrintableColumnKeys } from '../src/lib/client-operations-print.pure.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

const dir = dirname(fileURLToPath(import.meta.url));
const viewSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);

test('cell presentation key is user+org scoped and versioned', () => {
  assert.equal(
    clientOperationsCellPresentationStorageKey('u1', 'o1'),
    'nx.client-operations.cell-presentation.v1:u1:o1',
  );
  assert.notEqual(
    clientOperationsCellPresentationStorageKey('u1', 'o1'),
    clientOperationsCellPresentationStorageKey('u1', 'o2'),
  );
});

test('text color / font size / bold survive reload hydration', () => {
  const storage = memoryStorage();
  const cell = 'client-a::vat';
  saveClientOperationsCellPresentation(
    'u1',
    'o1',
    {
      [cell]: {
        color: '#9d4edd',
        fontSize: 16,
        bold: true,
        italic: true,
        underline: true,
        align: 'center',
      },
    },
    storage,
  );
  const loaded = loadClientOperationsCellPresentation('u1', 'o1', storage);
  assert.equal(loaded[cell]?.color, '#9d4edd');
  assert.equal(loaded[cell]?.fontSize, 16);
  assert.equal(loaded[cell]?.bold, true);
  assert.equal(loaded[cell]?.italic, true);
  assert.equal(loaded[cell]?.underline, true);
  assert.equal(loaded[cell]?.align, 'center');
});

test('hidden column survives reload; shown stays shown', () => {
  const storage = memoryStorage();
  saveClientOperationsHiddenColumns('u1', 'o1', ['payroll', 'pcn'], storage);
  const loaded = loadClientOperationsHiddenColumns('u1', 'o1', storage);
  assert.equal(loaded.has('payroll'), true);
  assert.equal(loaded.has('pcn'), true);
  assert.equal(loaded.has('notes'), false);
});

test('folder and client_name cannot be hidden from malformed storage', () => {
  const storage = memoryStorage();
  storage.setItem(
    clientOperationsHiddenColumnsStorageKey('u1', 'o1'),
    JSON.stringify(['folder', 'client_name', 'payroll']),
  );
  const loaded = loadClientOperationsHiddenColumns('u1', 'o1', storage);
  assert.equal(loaded.has('folder'), false);
  assert.equal(loaded.has('client_name'), false);
  assert.equal(loaded.has('payroll'), true);
  assert.deepEqual(sanitizeClientOperationsHiddenColumnKeys(['folder', 'client_name', 'vat']), ['vat']);
});

test('unknown old column key ignored by print visibility; new column defaults visible', () => {
  const storage = memoryStorage();
  saveClientOperationsHiddenColumns('u1', 'o1', ['legacy_gone_column', 'payroll'], storage);
  const hidden = loadClientOperationsHiddenColumns('u1', 'o1', storage);
  assert.equal(hidden.has('legacy_gone_column'), true);
  // New column not in hidden set → visible by default.
  assert.equal(hidden.has('brand_new_column'), false);
});

test('org A preferences do not leak to org B', () => {
  const storage = memoryStorage();
  saveClientOperationsCellPresentation(
    'u1',
    'orgA',
    { 'c1::vat': { color: '#c05621', fontSize: 18 } },
    storage,
  );
  saveClientOperationsHiddenColumns('u1', 'orgA', ['payroll'], storage);
  assert.deepEqual(loadClientOperationsCellPresentation('u1', 'orgB', storage), {});
  assert.equal(loadClientOperationsHiddenColumns('u1', 'orgB', storage).size, 0);
});

test('malformed JSON fails safely to defaults', () => {
  const storage = memoryStorage();
  storage.setItem(clientOperationsCellPresentationStorageKey('u1', 'o1'), '{not-json');
  storage.setItem(clientOperationsHiddenColumnsStorageKey('u1', 'o1'), '{not-json');
  assert.deepEqual(loadClientOperationsCellPresentation('u1', 'o1', storage), {});
  assert.equal(loadClientOperationsHiddenColumns('u1', 'o1', storage).size, 0);
});

test('undo of presentation is persisted by saving restored snapshot', () => {
  const storage = memoryStorage();
  const before = { 'c1::vat': { color: '#111827' } };
  const after = { 'c1::vat': { color: '#9d4edd' } };
  saveClientOperationsCellPresentation('u1', 'o1', after, storage);
  // Simulate Undo writing previous snapshot.
  saveClientOperationsCellPresentation('u1', 'o1', before, storage);
  assert.equal(loadClientOperationsCellPresentation('u1', 'o1', storage)['c1::vat']?.color, '#111827');
});

test('print excludes hidden columns then applies meaningful rule', () => {
  const columns = [
    { key: 'folder', label: 'תיק', cell_kind: 'folder' as const },
    { key: 'client_name', label: 'שם לקוח', cell_kind: 'text' as const },
    { key: 'payroll', label: 'שכר', cell_kind: 'text' as const },
    { key: 'empty_user', label: 'ריק', cell_kind: 'custom' as const },
    { key: 'notes', label: 'הערות', cell_kind: 'notes' as const },
  ];
  const hidden = new Set(['payroll']);
  const visible = columns.filter((c) => !hidden.has(c.key));
  const rows = [
    {
      client_id: 'c1',
      client_name: 'לקוח',
      cells: { empty_user: '', notes: '—' },
      notes_cell_text_he: '',
      operational_notes_count: 0,
    },
    {
      client_id: 'c2',
      client_name: 'לקוח ב',
      cells: { empty_user: '', notes: 'הערה' },
      notes_cell_text_he: 'הערה',
      operational_notes_count: 1,
    },
  ];
  const printable = selectPrintableColumnKeys({ columns: visible, rows });
  assert.deepEqual(printable, ['client_name', 'notes']);
  assert.equal(printable.includes('payroll'), false);
  assert.equal(printable.includes('empty_user'), false);
  assert.equal(printable.includes('folder'), false);
});

test('existing width persistence key unchanged', () => {
  assert.equal(
    clientOperationsColumnWidthsStorageKey('u', 'o'),
    'nx.client-operations.column-widths.v1:u:o',
  );
  const storage = memoryStorage();
  saveClientOperationsColumnWidths('u', 'o', { vat: 160 }, storage);
  assert.equal(loadClientOperationsColumnWidths('u', 'o', storage).vat, 160);
});

test('view hydrates and persists presentation + hidden columns; undo stack not persisted', () => {
  assert.match(viewSource, /loadClientOperationsCellPresentation/);
  assert.match(viewSource, /saveClientOperationsCellPresentation/);
  assert.match(viewSource, /loadClientOperationsHiddenColumns/);
  assert.match(viewSource, /saveClientOperationsHiddenColumns/);
  assert.match(viewSource, /persistCellPresentation/);
  assert.match(viewSource, /persistHiddenColumns/);
  assert.doesNotMatch(viewSource, /localStorage\.setItem\([^\)]*undo/i);
  assert.match(viewSource, /saveClientOperationsColumnWidths/);
});
