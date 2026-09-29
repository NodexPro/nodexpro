/**
 * Client Operations manual spreadsheet rows — pure + source contracts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLIENT_OPERATIONS_MANUAL_ROW_SLOT_COUNT,
  clientOperationsManualRowKey,
  clientOperationsManualRowSlots,
  isClientOperationsManualFreeTextColumnKey,
  isManualRowCompletelyEmptyForPrint,
  isMeaningfulManualCellValue,
  materializeClientOperationsManualRows,
  planManualRowCarryForward,
  previousOperationalPeriodKey,
} from '../../src/domains/client-operations/client-operations-manual-rows.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-manual-rows.service.ts'),
  'utf8',
);
const commandSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-registry-custom-columns.service.ts'),
  'utf8',
);
const aggregateSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations.service.ts'),
  'utf8',
);
const mig179 = readFileSync(
  join(dir, '../../../../supabase/migrations/179_client_operations_manual_spreadsheet_rows.sql'),
  'utf8',
);
const auditSource = readFileSync(join(dir, '../../src/shared/audit-events.ts'), 'utf8');

test('1 aggregate always materializes exactly five manual row slots', () => {
  assert.equal(CLIENT_OPERATIONS_MANUAL_ROW_SLOT_COUNT, 5);
  assert.deepEqual(clientOperationsManualRowSlots(), [1, 2, 3, 4, 5]);
  const rows = materializeClientOperationsManualRows({
    columnKeys: ['folder', 'client_name', 'vat'],
    valuesBySlotColumn: new Map(),
  });
  assert.equal(rows.length, 5);
  assert.deepEqual(
    rows.map((r) => r.manual_row_slot),
    [1, 2, 3, 4, 5],
  );
});

test('2 manual rows ordered after real clients — aggregate appends manual_rows separately', () => {
  assert.match(aggregateSource, /manual_rows,/);
  assert.match(aggregateSource, /buildManualRowsForRegistryAggregate/);
  assert.match(aggregateSource, /rows,\s*manual_rows/s);
});

test('3 no client_id fabricated', () => {
  const rows = materializeClientOperationsManualRows({
    columnKeys: ['client_name'],
    valuesBySlotColumn: new Map([['1:client_name', 'ABC']]),
  });
  for (const row of rows) {
    assert.equal(row.client_id, null);
    assert.equal(row.row_kind, 'manual');
    assert.match(row.row_key, /^manual:0[1-5]$/);
  }
  assert.doesNotMatch(mig179, /references public\.clients/);
  assert.doesNotMatch(mig179, /client_id uuid/);
});

test('4 folder/action absent — folder not free-text editable', () => {
  assert.equal(isClientOperationsManualFreeTextColumnKey('folder'), false);
  const rows = materializeClientOperationsManualRows({
    columnKeys: ['folder', 'vat'],
    valuesBySlotColumn: new Map(),
  });
  assert.equal(rows[0]!.cell_presentation.folder?.cell_kind, 'folder');
  assert.equal(rows[0]!.cell_presentation.folder?.editable, false);
  assert.equal(rows[0]!.cell_presentation.vat?.cell_kind, 'manual_text');
  assert.equal(rows[0]!.cell_presentation.vat?.editable, true);
});

test('5 cells backend-described as free text/editable for system obligation columns', () => {
  for (const key of [
    'vat',
    'payroll',
    'material_brought',
    'pcn',
    'income_tax_advance',
    'national_insurance',
    'national_insurance_deductions',
    'income_tax_deductions',
    'annual_report',
    'capital_declaration',
  ]) {
    assert.equal(isClientOperationsManualFreeTextColumnKey(key), true, key);
  }
  assert.equal(isClientOperationsManualFreeTextColumnKey('user_slot_01'), true);
});

test('6 UI must not infer VAT/payroll — backend cell_presentation only', () => {
  const pureSource = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations-manual-rows.pure.ts'),
    'utf8',
  );
  assert.match(pureSource, /cell_presentation/);
  assert.match(pureSource, /manual_text/);
  assert.doesNotMatch(serviceSource, /set_material_brought|set_payroll|vat_status/);
});

test('7 named commands only (cell value + period init)', () => {
  assert.match(commandSource, /set_client_operations_manual_row_cell_value/);
  assert.match(commandSource, /initialize_client_operations_manual_rows_for_period/);
  assert.doesNotMatch(commandSource, /PATCH.*manual_row|manual_row.*PATCH/i);
});

test('8 command returns full refreshed aggregate', () => {
  assert.match(commandSource, /set_client_operations_manual_row_cell_value/);
  assert.match(commandSource, /return listClientOperationsRegistry\(ctx, responseQuery\)/);
});

test('9-11 tenant RBAC audit', () => {
  assert.match(serviceSource, /organization_id/);
  assert.match(commandSource, /assertEdit\(ctx\)/);
  assert.match(auditSource, /CLIENT_OPERATIONS_MANUAL_ROW_CELL_VALUE_SET/);
  assert.match(auditSource, /CLIENT_OPERATIONS_MANUAL_ROWS_PERIOD_INITIALIZED/);
  assert.match(serviceSource, /CLIENT_OPERATIONS_MANUAL_ROW_CELL_VALUE_SET/);
  assert.match(serviceSource, /CLIENT_OPERATIONS_MANUAL_ROWS_PERIOD_INITIALIZED/);
  assert.doesNotMatch(serviceSource, /work_item|work_engine/i);
});

test('12 invalid slot rejected via pure parse', async () => {
  const { parseClientOperationsManualRowSlot } = await import(
    '../../src/domains/client-operations/client-operations-manual-rows.pure.js'
  );
  assert.throws(() => parseClientOperationsManualRowSlot(0));
  assert.throws(() => parseClientOperationsManualRowSlot(6));
  assert.throws(() => parseClientOperationsManualRowSlot('x'));
  assert.match(serviceSource, /manual_row_slot must be an integer 1\.\.5/);
});

test('13 invalid column rejected', () => {
  assert.match(serviceSource, /column_key is not eligible for manual row free text/);
  assert.match(serviceSource, /column_key is not part of the Client Operations registry table/);
  assert.equal(isClientOperationsManualFreeTextColumnKey('folder'), false);
});

test('14-15 previous period carry copies meaningful slots only', () => {
  assert.equal(previousOperationalPeriodKey('2026-10'), '2026-09');
  assert.equal(previousOperationalPeriodKey('2026-01'), '2025-12');
  const plan = planManualRowCarryForward({
    previousValues: [
      { slot: 1, column_key: 'client_name', value_text: 'ABC' },
      { slot: 1, column_key: 'notes', value_text: 'call' },
      { slot: 2, column_key: 'client_name', value_text: '' },
      { slot: 3, column_key: 'folder', value_text: 'nope' },
    ],
  });
  assert.ok(plan.some((p) => p.slot === 1 && p.column_key === 'client_name' && p.value_text === 'ABC'));
  assert.ok(plan.some((p) => p.slot === 1 && p.column_key === 'notes'));
  assert.ok(!plan.some((p) => p.slot === 2));
  assert.ok(!plan.some((p) => p.column_key === 'folder'));
});

test('18-20 clearing stops carry — empty previous slot not copied', () => {
  const plan = planManualRowCarryForward({
    previousValues: [{ slot: 1, column_key: 'client_name', value_text: '   ' }],
  });
  assert.equal(plan.length, 0);
});

test('21 carry-forward uses immediate previous calendar period only (atomic RPC)', () => {
  assert.match(mig179, /initialize_client_operations_manual_rows_for_period/);
  assert.match(mig179, /on conflict \(organization_id, operational_period_key\) do nothing/);
  assert.match(serviceSource, /initialize_client_operations_manual_rows_for_period/);
  assert.doesNotMatch(serviceSource, /latestEarlierPeriodKey/);
  assert.doesNotMatch(mig179, /latestEarlierPeriodKey/);
  // RPC computes previous month in SQL (no older-month scan).
  assert.match(mig179, /v_prev/);
  assert.match(mig179, /v_month := v_month - 1/);
});

test('22-23 empty slots remain empty; five independent', () => {
  const rows = materializeClientOperationsManualRows({
    columnKeys: ['client_name'],
    valuesBySlotColumn: new Map([['3:client_name', 'only-three']]),
  });
  assert.equal(rows[0]!.cells.client_name, '');
  assert.equal(rows[2]!.cells.client_name, 'only-three');
  assert.equal(clientOperationsManualRowKey(3), 'manual:03');
});

test('migration 179 schema + RLS + no destructive DROP', () => {
  assert.match(mig179, /client_operations_manual_row_cell_values/);
  assert.match(mig179, /client_operations_manual_rows_period_setup/);
  assert.match(mig179, /manual_row_slot smallint/);
  assert.match(mig179, /check \(manual_row_slot >= 1 and manual_row_slot <= 5\)/);
  assert.match(mig179, /operational_period_key ~ '\^\\d\{4\}-\(0\[1-9\]\|1\[0-2\]\)\$'/);
  assert.match(mig179, /enable row level security/);
  assert.match(mig179, /co_manual_row_cell_values_select_org_member/);
  assert.match(mig179, /co_manual_row_cell_values_insert_org_member/);
  assert.match(mig179, /co_manual_row_cell_values_update_org_member/);
  assert.match(mig179, /co_manual_row_cell_values_delete_org_member/);
  assert.match(mig179, /co_manual_rows_period_setup_select_org_member/);
  assert.match(mig179, /co_manual_rows_period_setup_insert_org_member/);
  assert.match(mig179, /co_manual_rows_period_setup_update_org_member/);
  assert.match(mig179, /co_manual_rows_period_setup_delete_org_member/);
  assert.match(mig179, /organizations_for_current_auth_user\(\)/);
  assert.match(mig179, /grant execute[\s\S]*service_role/);
  assert.doesNotMatch(mig179, /\bDROP\s+(TABLE|POLICY|FUNCTION)\b/i);
  assert.doesNotMatch(mig179, /references public\.clients/);
});

test('print empty vs filled', () => {
  assert.equal(isManualRowCompletelyEmptyForPrint({ cells: { client_name: '', vat: '—' } }), true);
  assert.equal(isManualRowCompletelyEmptyForPrint({ cells: { client_name: 'ABC' } }), false);
  assert.equal(isMeaningfulManualCellValue(''), false);
  assert.equal(isMeaningfulManualCellValue('x'), true);
});

test('READ path never initializes — no hidden GET write', () => {
  assert.match(serviceSource, /Aggregate READ only/);
  assert.doesNotMatch(serviceSource, /ensureManualRowsInitializedForPeriod/);
  // buildManualRowsForRegistryAggregate must not call initialize
  const buildFn = serviceSource.slice(
    serviceSource.indexOf('export async function buildManualRowsForRegistryAggregate'),
    serviceSource.indexOf('export async function buildManualRowsPeriodSetupForAggregate'),
  );
  assert.doesNotMatch(buildFn, /initializeManualRowsForPeriod/);
  assert.doesNotMatch(buildFn, /\.insert\(|\.upsert\(|\.rpc\(/);
  assert.doesNotMatch(aggregateSource, /initializeManualRowsForPeriod/);
  assert.match(aggregateSource, /manual_rows_period_setup/);
  assert.match(aggregateSource, /buildManualRowsPeriodSetupForAggregate/);
});

test('first-touch setup marker via named command + atomic RPC', () => {
  assert.match(serviceSource, /client_operations_manual_rows_period_setup/);
  assert.match(serviceSource, /initializeManualRowsForPeriod/);
  assert.match(serviceSource, /isManualRowsPeriodSetupComplete/);
  assert.match(commandSource, /initialize_client_operations_manual_rows_for_period/);
  assert.match(mig179, /security definer/);
});

test('09.26 → 10.26 carry; clear 10.26 → 11.26 empty; no resurrection', () => {
  // Initialize 10.26 from 09.26
  const from09 = planManualRowCarryForward({
    previousValues: [
      { slot: 1, column_key: 'client_name', value_text: 'ABC' },
      { slot: 1, column_key: 'notes', value_text: 'call' },
    ],
  });
  assert.equal(from09.length, 2);
  assert.ok(from09.some((p) => p.value_text === 'ABC'));
  assert.ok(from09.some((p) => p.value_text === 'call'));

  // After clear every manual:01 value in 10.26, initialize 11.26 from 10.26 → empty
  const from10Cleared = planManualRowCarryForward({
    previousValues: [
      { slot: 1, column_key: 'client_name', value_text: '' },
      { slot: 1, column_key: 'notes', value_text: '   ' },
    ],
  });
  assert.equal(from10Cleared.length, 0);

  // Editing 09.26 later does not affect already-initialized 10.26 — carry only reads immediate previous at init time.
  assert.equal(previousOperationalPeriodKey('2026-11'), '2026-10');
  assert.notEqual(previousOperationalPeriodKey('2026-11'), '2026-09');
});

test('value length limit and empty-string sparse delete', () => {
  assert.match(serviceSource, /CLIENT_OPERATIONS_MANUAL_CELL_VALUE_MAX_LENGTH = 4000/);
  assert.match(serviceSource, /\.delete\(\)/);
  assert.match(mig179, /char_length\(value_text\) <= 4000/);
});

test('migration number 179 is unique among CO migrations', () => {
  const migrationsDir = join(dir, '../../../../supabase/migrations');
  const matches = readdirSync(migrationsDir).filter((f) => f.startsWith('179_'));
  assert.deepEqual(matches, ['179_client_operations_manual_spreadsheet_rows.sql']);
});
