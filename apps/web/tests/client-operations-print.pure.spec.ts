import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isMeaningfulPrintableCellValue,
  isMeaningfulPrintableRegistryCell,
  isManualRowCompletelyEmptyForPrint,
  selectPrintableColumnKeys,
  selectPrintableManualRows,
  formatClientOperationsPeriodHeading,
  type ClientOperationsPrintColumn,
  type ClientOperationsPrintRow,
} from '../src/lib/client-operations-print.pure.js';

// ── isMeaningfulPrintableCellValue ──────────────────────────────

test('null and undefined are not meaningful', () => {
  assert.equal(isMeaningfulPrintableCellValue(null), false);
  assert.equal(isMeaningfulPrintableCellValue(undefined), false);
});

test('empty string and whitespace are not meaningful', () => {
  assert.equal(isMeaningfulPrintableCellValue(''), false);
  assert.equal(isMeaningfulPrintableCellValue('   '), false);
});

test('dash variants are not meaningful', () => {
  assert.equal(isMeaningfulPrintableCellValue('—'), false);
  assert.equal(isMeaningfulPrintableCellValue('–'), false);
  assert.equal(isMeaningfulPrintableCellValue('-'), false);
});

test('real text is meaningful', () => {
  assert.equal(isMeaningfulPrintableCellValue('שלום'), true);
  assert.equal(isMeaningfulPrintableCellValue('hello'), true);
  assert.equal(isMeaningfulPrintableCellValue('0'), true);
});

// ── isMeaningfulPrintableRegistryCell ──────────────────────────

test('folder column is never meaningful for print', () => {
  const col: ClientOperationsPrintColumn = { key: 'folder', label: 'תיק', cell_kind: 'folder' };
  const row: ClientOperationsPrintRow = { client_id: 'c1', client_name: 'Test' };
  assert.equal(isMeaningfulPrintableRegistryCell(row, col), false);
});

test('client_name column is meaningful when client name present', () => {
  const col: ClientOperationsPrintColumn = { key: 'client_name', label: 'שם', cell_kind: 'text' };
  const row: ClientOperationsPrintRow = { client_id: 'c1', client_name: 'ישראל ישראלי' };
  assert.equal(isMeaningfulPrintableRegistryCell(row, col), true);
});

test('client_name column is not meaningful when name is null', () => {
  const col: ClientOperationsPrintColumn = { key: 'client_name', label: 'שם', cell_kind: 'text' };
  const row: ClientOperationsPrintRow = { client_id: 'c1', client_name: null };
  assert.equal(isMeaningfulPrintableRegistryCell(row, col), false);
});

test('manual status ready makes cell meaningful', () => {
  const col: ClientOperationsPrintColumn = { key: 'vat', label: 'מע"מ', cell_kind: 'text' };
  const row: ClientOperationsPrintRow = {
    client_id: 'c1',
    manual_cell_statuses: { vat: { status: 'ready' } },
  };
  assert.equal(isMeaningfulPrintableRegistryCell(row, col), true);
});

test('custom cell with empty value is not meaningful', () => {
  const col: ClientOperationsPrintColumn = { key: 'custom_1', label: 'שדה', cell_kind: 'custom' };
  const row: ClientOperationsPrintRow = {
    client_id: 'c1',
    cells: { custom_1: '' },
  };
  assert.equal(isMeaningfulPrintableRegistryCell(row, col), false);
});

test('custom cell with real value is meaningful', () => {
  const col: ClientOperationsPrintColumn = { key: 'custom_1', label: 'שדה', cell_kind: 'custom' };
  const row: ClientOperationsPrintRow = {
    client_id: 'c1',
    cells: { custom_1: 'ערך כלשהו' },
  };
  assert.equal(isMeaningfulPrintableRegistryCell(row, col), true);
});

// ── selectPrintableColumnKeys ───────────────────────────────────

test('folder column is always excluded from printable', () => {
  const columns: ClientOperationsPrintColumn[] = [
    { key: 'folder', label: 'תיק', cell_kind: 'folder' },
    { key: 'client_name', label: 'שם', cell_kind: 'text' },
  ];
  const rows: ClientOperationsPrintRow[] = [
    { client_id: 'c1', client_name: 'Test' },
  ];
  const keys = selectPrintableColumnKeys({ columns, rows });
  assert.ok(!keys.includes('folder'));
  assert.ok(keys.includes('client_name'));
});

test('client_name always included when present', () => {
  const columns: ClientOperationsPrintColumn[] = [
    { key: 'client_name', label: 'שם', cell_kind: 'text' },
    { key: 'vat', label: 'מע"מ', cell_kind: 'text' },
  ];
  const rows: ClientOperationsPrintRow[] = [
    { client_id: 'c1', client_name: 'Client A', cells: { vat: '—' } },
  ];
  const keys = selectPrintableColumnKeys({ columns, rows });
  assert.ok(keys.includes('client_name'));
});

test('column with no meaningful data across all rows is excluded', () => {
  const columns: ClientOperationsPrintColumn[] = [
    { key: 'client_name', label: 'שם', cell_kind: 'text' },
    { key: 'custom_empty', label: 'ריק', cell_kind: 'custom' },
    { key: 'custom_filled', label: 'מלא', cell_kind: 'custom' },
  ];
  const rows: ClientOperationsPrintRow[] = [
    {
      client_id: 'c1',
      client_name: 'Client A',
      cells: { custom_empty: '', custom_filled: 'data' },
    },
    {
      client_id: 'c2',
      client_name: 'Client B',
      cells: { custom_empty: '—', custom_filled: 'more' },
    },
  ];
  const keys = selectPrintableColumnKeys({ columns, rows });
  assert.ok(!keys.includes('custom_empty'));
  assert.ok(keys.includes('custom_filled'));
});

test('empty rows produce only client_name key', () => {
  const columns: ClientOperationsPrintColumn[] = [
    { key: 'client_name', label: 'שם', cell_kind: 'text' },
    { key: 'vat', label: 'מע"מ', cell_kind: 'text' },
  ];
  const keys = selectPrintableColumnKeys({ columns, rows: [] });
  // With no rows, client_name still always included
  assert.ok(keys.includes('client_name'));
  // vat has no rows with data
  assert.ok(!keys.includes('vat'));
});

// ── formatClientOperationsPeriodHeading ────────────────────────

test('YYYY-MM format converts to MM.YY', () => {
  assert.equal(formatClientOperationsPeriodHeading('2026-08'), '08.26');
});

test('YYYY-MM format: month 01 pads correctly', () => {
  assert.equal(formatClientOperationsPeriodHeading('2025-01'), '01.25');
});

test('null or empty falls back to default', () => {
  assert.equal(formatClientOperationsPeriodHeading(null), 'תקופה');
  assert.equal(formatClientOperationsPeriodHeading(''), 'תקופה');
  assert.equal(formatClientOperationsPeriodHeading(undefined), 'תקופה');
});

test('non-standard key passes through as-is', () => {
  assert.equal(formatClientOperationsPeriodHeading('annual'), 'annual');
});

// ── Manual rows print filter ───────────────────────────────────

test('empty manual row is completely empty for print', () => {
  assert.equal(
    isManualRowCompletelyEmptyForPrint({
      cells: { folder: '', client_name: '', vat: '', payroll: '—' },
    }),
    true,
  );
});

test('filled manual row is not empty for print', () => {
  assert.equal(
    isManualRowCompletelyEmptyForPrint({
      cells: { folder: '', client_name: '', vat: 'הערה', payroll: '' },
    }),
    false,
  );
});

test('selectPrintableManualRows excludes empty slots', () => {
  const rows = [
    { row_key: 'manual:01', cells: { vat: '', payroll: '' } },
    { row_key: 'manual:02', cells: { vat: 'x', payroll: '' } },
    { row_key: 'manual:03', cells: { vat: '—', payroll: '–' } },
  ];
  const printable = selectPrintableManualRows(rows);
  assert.equal(printable.length, 1);
  assert.equal(printable[0]?.row_key, 'manual:02');
});
