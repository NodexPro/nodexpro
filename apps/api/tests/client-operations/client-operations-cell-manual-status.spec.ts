import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  countMaterialOperationalSquares,
  countNiDeductionsOperationalSquares,
  isClientOperationsManualStatusPaintableColumnKey,
  mergeSelectedPeriodIntoAvailablePeriods,
  resolveAllowedManualStatuses,
} from '../../src/domains/client-operations/client-operations-cell-manual-status.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(dir, '../../../../supabase/migrations/178_client_operations_cell_manual_status.sql'),
  'utf8',
);
const serviceSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations.service.ts'),
  'utf8',
);
const commandSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-registry-custom-columns.service.ts'),
  'utf8',
);
const pageSource = readFileSync(
  join(dir, '../../../web/src/pages/ClientOperationsRegistry.tsx'),
  'utf8',
);
const viewSource = readFileSync(
  join(dir, '../../../web/src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);

test('migration 178 schema-only manual status; no legacy/period value fabrication', () => {
  assert.match(migration, /client_operations_cell_manual_statuses/);
  assert.match(migration, /ready.*sent_for_approval.*completed/s);
  assert.doesNotMatch(migration, /insert into/i);
  assert.doesNotMatch(migration, /177_/);
});

test('selected period merges into available tabs without reload', () => {
  assert.deepEqual(
    mergeSelectedPeriodIntoAvailablePeriods({
      availablePeriods: ['2026-08', '2026-09'],
      selectedPeriodKey: '2026-11',
    }),
    ['2026-08', '2026-09', '2026-11'],
  );
  assert.match(serviceSource, /mergeSelectedPeriodIntoAvailablePeriods/);
});

test('eligibility: ordinary/custom allow yellow blue green; multi-square yellow/blue rejected', () => {
  assert.deepEqual(
    resolveAllowedManualStatuses({
      columnKey: 'user_slot_01',
      operationalSquareCount: 0,
      currentStatus: null,
      isCustomColumn: true,
    }),
    ['ready', 'sent_for_approval', 'completed'],
  );
  assert.deepEqual(
    resolveAllowedManualStatuses({
      columnKey: 'income_tax_deductions',
      operationalSquareCount: 1,
      currentStatus: null,
      isCustomColumn: false,
    }),
    ['ready', 'sent_for_approval', 'completed'],
  );
  assert.deepEqual(
    resolveAllowedManualStatuses({
      columnKey: 'national_insurance_deductions',
      operationalSquareCount: 3,
      currentStatus: null,
      isCustomColumn: false,
    }),
    ['completed'],
  );
  assert.deepEqual(
    resolveAllowedManualStatuses({
      columnKey: 'national_insurance_deductions',
      operationalSquareCount: 3,
      currentStatus: 'completed',
      isCustomColumn: false,
    }),
    ['completed', 'clear'],
  );
  assert.equal(isClientOperationsManualStatusPaintableColumnKey('folder'), false);
  assert.equal(isClientOperationsManualStatusPaintableColumnKey('client_name'), false);
  assert.equal(countMaterialOperationalSquares({
    vatApplicable: true,
    incomeTaxAdvanceApplicable: true,
    payrollApplicable: false,
  }), 2);
  assert.equal(countNiDeductionsOperationalSquares({
    applicable: true,
    form102Applicable: true,
    form100Applicable: true,
    form126Applicable: true,
  }), 3);
});

test('named command + audit for manual status', () => {
  assert.match(commandSource, /set_client_operations_cell_manual_status/);
  assert.match(commandSource, /setClientOperationsCellManualStatus/);
  assert.match(commandSource, /resolveAllowedManualStatusesForWrite/);
});

test('instant period switch uses quiet load + cache; no blocking dirty await', () => {
  assert.match(pageSource, /preferCache/);
  assert.match(pageSource, /quiet:\s*true/);
  assert.match(pageSource, /putPeriodAggregateCache/);
  assert.match(pageSource, /shouldApplyPeriodAggregateResponse/);
  assert.match(viewSource, /flushDirtyBeforePeriodChange/);
  assert.match(viewSource, /for \(const key of keys\) void flushCustomCellKey\(key\)/);
  assert.match(viewSource, /onPeriodChange\?\.\(nextPeriodKey\)/);
  assert.doesNotMatch(viewSource, /await Promise\.all\(\[\.\.\.keys\]\.map/);
});

test('Enter commits without awaiting flush; autosave 500 preserved', () => {
  assert.match(viewSource, /commitCustomCellEdit = \(/);
  assert.match(viewSource, /void flushCustomCellKey\(key\)/);
  assert.match(viewSource, /500/);
  assert.match(viewSource, /tryStartCustomCellSave/);
  assert.match(viewSource, /shouldApplyCellSaveAggregate/);
});

test('status paint modes and backend-owned capabilities', () => {
  assert.match(viewSource, /manualStatusPaintModes/);
  assert.match(viewSource, /nx-co-sheet__status-mode/);
  assert.match(viewSource, /paintCellManualStatus/);
  assert.match(viewSource, /manual_cell_statuses/);
  assert.match(serviceSource, /manual_status_paint_modes/);
  assert.match(serviceSource, /manual_cell_statuses/);
  assert.doesNotMatch(viewSource, /querySelectorAll|getElementsByClassName/);
});
