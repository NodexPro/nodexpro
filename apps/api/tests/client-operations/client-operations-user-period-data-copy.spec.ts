/**
 * Explicit user-entered period data copy — pure + contract tests.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseUserPeriodDataCopyMode,
  planCustomColumnPeriodValueCopies,
  planManualRowPeriodValueCopies,
  shouldCopyUserEnteredValue,
  sourcePeriodsForUserPeriodDataCopy,
  targetPeriodHasConflictingUserEnteredData,
} from '../../src/domains/client-operations/client-operations-user-period-data-copy.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const periodsService = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-user-columns-periods.service.ts'),
  'utf8',
);
const manualService = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-manual-rows.service.ts'),
  'utf8',
);
const commandService = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-registry-custom-columns.service.ts'),
  'utf8',
);
const copyService = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-user-period-data-copy.service.ts'),
  'utf8',
);
const auditSource = readFileSync(join(dir, '../../src/shared/audit-events.ts'), 'utf8');

test('1-4 copy custom text/number/date/bool plans', () => {
  const plan = planCustomColumnPeriodValueCopies({
    mode: 'empty_only',
    eligibleColumnIds: new Set(['col-t', 'col-n', 'col-d', 'col-b']),
    sourceRows: [
      { client_id: 'c1', column_id: 'col-t', value_text: 'הערה', value_number: null, value_date: null, value_bool: null },
      { client_id: 'c1', column_id: 'col-n', value_text: null, value_number: 12.5, value_date: null, value_bool: null },
      { client_id: 'c1', column_id: 'col-d', value_text: null, value_number: null, value_date: '2026-08-15', value_bool: null },
      { client_id: 'c1', column_id: 'col-b', value_text: null, value_number: null, value_date: null, value_bool: true },
    ],
    targetRows: [],
  });
  assert.equal(plan.length, 4);
  assert.ok(plan.some((p) => p.column_id === 'col-t' && p.values.value_text === 'הערה'));
  assert.ok(plan.some((p) => p.column_id === 'col-n' && p.values.value_number === 12.5));
  assert.ok(plan.some((p) => p.column_id === 'col-d' && p.values.value_date === '2026-08-15'));
  assert.ok(plan.some((p) => p.column_id === 'col-b' && p.values.value_bool === true));
});

test('5 copy manual-row text value', () => {
  const plan = planManualRowPeriodValueCopies({
    mode: 'empty_only',
    sourceRows: [{ slot: 1, column_key: 'client_name', value_text: 'ABC' }],
    targetRows: [],
  });
  assert.deepEqual(plan, [{ slot: 1, column_key: 'client_name', value_text: 'ABC' }]);
});

test('8-10 EMPTY_ONLY does not overwrite; fills empty', () => {
  assert.equal(
    shouldCopyUserEnteredValue({ mode: 'empty_only', sourceMeaningful: true, targetMeaningful: true }),
    false,
  );
  assert.equal(
    shouldCopyUserEnteredValue({ mode: 'empty_only', sourceMeaningful: true, targetMeaningful: false }),
    true,
  );
  const custom = planCustomColumnPeriodValueCopies({
    mode: 'empty_only',
    eligibleColumnIds: new Set(['col1']),
    sourceRows: [
      { client_id: 'c1', column_id: 'col1', value_text: 'from-src', value_number: null, value_date: null, value_bool: null },
      { client_id: 'c2', column_id: 'col1', value_text: 'open', value_number: null, value_date: null, value_bool: null },
    ],
    targetRows: [
      { client_id: 'c1', column_id: 'col1', value_text: 'keep-me', value_number: null, value_date: null, value_bool: null },
    ],
  });
  assert.ok(!custom.some((p) => p.client_id === 'c1'));
  assert.ok(custom.some((p) => p.client_id === 'c2' && p.values.value_text === 'open'));

  const manual = planManualRowPeriodValueCopies({
    mode: 'empty_only',
    sourceRows: [
      { slot: 1, column_key: 'notes', value_text: 'src' },
      { slot: 2, column_key: 'notes', value_text: 'fill' },
    ],
    targetRows: [{ slot: 1, column_key: 'notes', value_text: 'target-keep' }],
  });
  assert.ok(!manual.some((p) => p.slot === 1));
  assert.ok(manual.some((p) => p.slot === 2 && p.value_text === 'fill'));
});

test('11-12 REPLACE_EXISTING overwrites meaningful; never erases from empty source', () => {
  assert.equal(
    shouldCopyUserEnteredValue({ mode: 'replace_existing', sourceMeaningful: true, targetMeaningful: true }),
    true,
  );
  assert.equal(
    shouldCopyUserEnteredValue({ mode: 'replace_existing', sourceMeaningful: false, targetMeaningful: true }),
    false,
  );
  const custom = planCustomColumnPeriodValueCopies({
    mode: 'replace_existing',
    eligibleColumnIds: new Set(['col1', 'col2']),
    sourceRows: [
      { client_id: 'c1', column_id: 'col1', value_text: 'new', value_number: null, value_date: null, value_bool: null },
      { client_id: 'c1', column_id: 'col2', value_text: null, value_number: null, value_date: null, value_bool: null },
    ],
    targetRows: [
      { client_id: 'c1', column_id: 'col1', value_text: 'old', value_number: null, value_date: null, value_bool: null },
      { client_id: 'c1', column_id: 'col2', value_text: 'keep', value_number: null, value_date: null, value_bool: null },
    ],
  });
  assert.equal(custom.length, 1);
  assert.equal(custom[0]!.values.value_text, 'new');
});

test('13 source==target and invalid mode rejected by parsers/helpers', () => {
  assert.throws(() => parseUserPeriodDataCopyMode('nope'));
  assert.deepEqual(sourcePeriodsForUserPeriodDataCopy(['2026-08', '2026-09'], '2026-09'), ['2026-08']);
  assert.ok(!sourcePeriodsForUserPeriodDataCopy(['2026-09'], '2026-09').includes('2026-09'));
});

test('17-18 system fields / status paint not in copy planner surface', () => {
  assert.doesNotMatch(copyService, /material_brought|vat_status|pcn|set_material_brought/);
  assert.doesNotMatch(copyService, /cell_manual_status|manual_statuses/);
  assert.match(copyService, /client_operations_registry_custom_column_period_values/);
  assert.match(copyService, /client_operations_manual_row_cell_values/);
});

test('19-20 no duplicate column identity; visibility ensure only', () => {
  assert.match(copyService, /ensureVisibilityRowForPeriod/);
  assert.doesNotMatch(copyService, /create_client_operations_custom_column|insert\([\s\S]*custom_columns/);
  assert.match(copyService, /eligibleColumnIds/);
});

test('21-23 command invalidates cache + returns target aggregate', () => {
  assert.match(commandService, /copy_client_operations_user_period_data/);
  assert.match(commandService, /invalidateClientOperationsRegistryMaterializationCache\(orgId\)/);
  assert.match(commandService, /target_operational_period_key/);
  assert.match(commandService, /return listClientOperationsRegistry\(ctx, responseQuery\)/);
  const copyBranch = commandService.slice(
    commandService.indexOf("command === 'copy_client_operations_user_period_data'"),
  );
  assert.match(copyBranch, /copyClientOperationsUserPeriodData/);
});

test('tenant RBAC audit + mode default', () => {
  assert.match(commandService, /assertEdit\(ctx\)/);
  assert.match(auditSource, /CLIENT_OPERATIONS_USER_PERIOD_DATA_COPIED/);
  assert.match(copyService, /CLIENT_OPERATIONS_USER_PERIOD_DATA_COPIED/);
  assert.match(commandService, /mode: body\.mode \?\? 'empty_only'/);
  assert.match(copyService, /organization_id: input\.organizationId/);
});

test('25 no automatic value copy on period init / period settings', () => {
  assert.doesNotMatch(periodsService, /carryForwardColumnIntoPeriod/);
  const initFn = periodsService.slice(
    periodsService.indexOf('export async function initializeUserColumnsForPeriod'),
    periodsService.indexOf('export async function setPeriodCustomColumnValue'),
  );
  assert.doesNotMatch(initFn, /period_values/);
  assert.match(initFn, /ensureVisibilityRowForPeriod/);
  const settingsFn = periodsService.slice(
    periodsService.indexOf('export async function setCustomColumnPeriodSettings'),
    periodsService.indexOf('export async function initializeUserColumnsForPeriod'),
  );
  assert.doesNotMatch(settingsFn, /period_values[\s\S]{0,40}upsert/);
  assert.match(settingsFn, /ensureVisibilityRowForPeriod/);
  assert.doesNotMatch(manualService, /initialize_client_operations_manual_rows_for_period/);
  assert.match(manualService, /WITHOUT copying prior-period cell VALUES/);
});

test('folder column never copied in manual planner', () => {
  const plan = planManualRowPeriodValueCopies({
    mode: 'replace_existing',
    sourceRows: [{ slot: 1, column_key: 'folder', value_text: 'nope' }],
    targetRows: [],
  });
  assert.equal(plan.length, 0);
});

test('conflict helper for UX', () => {
  assert.equal(
    targetPeriodHasConflictingUserEnteredData({ customCellTexts: [''], manualCellTexts: ['—'] }),
    false,
  );
  assert.equal(
    targetPeriodHasConflictingUserEnteredData({ customCellTexts: ['x'], manualCellTexts: [] }),
    true,
  );
});

test('copy-source periods: custom-only / manual-only / both / empty placeholders', async () => {
  const { buildUserPeriodDataCopySourcePeriods } = await import(
    '../../src/domains/client-operations/client-operations-user-period-data-copy.pure.js'
  );
  assert.deepEqual(
    buildUserPeriodDataCopySourcePeriods({
      customPeriodKeys: ['2026-03', '2026-08'],
      manualPeriodKeys: [],
    }),
    ['2026-08', '2026-03'],
  );
  assert.deepEqual(
    buildUserPeriodDataCopySourcePeriods({
      customPeriodKeys: [],
      manualPeriodKeys: ['2026-05'],
    }),
    ['2026-05'],
  );
  assert.deepEqual(
    buildUserPeriodDataCopySourcePeriods({
      customPeriodKeys: ['2026-08', '2026-03'],
      manualPeriodKeys: ['2026-08', '2026-05'],
    }),
    ['2026-08', '2026-05', '2026-03'],
  );
  assert.deepEqual(
    buildUserPeriodDataCopySourcePeriods({
      customPeriodKeys: ['', 'bogus', '2026-99'],
      manualPeriodKeys: ['not-a-period'],
    }),
    [],
  );
});

test('aggregate exposes dedicated copy-source field without changing available_periods discovery', () => {
  const serviceSource = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations.service.ts'),
    'utf8',
  );
  assert.match(serviceSource, /user_period_data_copy_source_periods/);
  assert.match(serviceSource, /loadUserPeriodDataCopySourcePeriods\(orgId, manualWorkspace\)/);
  assert.match(serviceSource, /listKnownOperationalPeriodKeys\(orgId\)/);
  // available_periods still comes only from known operational keys (snapshots/material + default).
  const knownFn = readFileSync(
    join(dir, '../../src/domains/client-operations/client-operations-operational-period.service.ts'),
    'utf8',
  );
  assert.match(knownFn, /client_operations_period_applicability_snapshots/);
  assert.match(knownFn, /client_operations_period_material_facts/);
  assert.doesNotMatch(knownFn, /client_operations_registry_custom_column_period_values/);
  assert.doesNotMatch(knownFn, /client_operations_manual_row_cell_values/);
  assert.match(copyService, /\.eq\('organization_id', organizationId\)/);
  assert.match(copyService, /isMeaningfulTypedValue/);
  assert.match(copyService, /isMeaningfulManualCellValue/);
  assert.match(copyService, /loadUserPeriodDataCopySourcePeriods/);
});
