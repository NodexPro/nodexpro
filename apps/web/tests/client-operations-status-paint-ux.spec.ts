import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
const viewSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const cssSource = readFileSync(join(dir, '../src/styles/nx-client-operations-spreadsheet.css'), 'utf8');
const cacheSource = readFileSync(
  join(dir, '../src/lib/client-operations-period-aggregate-cache.pure.ts'),
  'utf8',
);

test('instant period switch: cache + quiet + no blocking dirty await', () => {
  assert.match(pageSource, /preferCache:\s*true/);
  assert.match(pageSource, /quiet:\s*true/);
  assert.match(pageSource, /getPeriodAggregateCache/);
  assert.match(pageSource, /putPeriodAggregateCache/);
  assert.match(pageSource, /shouldApplyPeriodAggregateResponse/);
  assert.match(pageSource, /selectPeriodPrefetchKeys/);
  assert.match(viewSource, /flushDirtyBeforePeriodChange/);
  assert.match(viewSource, /for \(const key of keys\) void flushCustomCellKey\(key\)/);
  assert.match(viewSource, /onPeriodChange\?\.\(nextPeriodKey\)/);
  assert.doesNotMatch(viewSource, /await Promise\.all\(\[\.\.\.keys\]\.map/);
  assert.match(cacheSource, /shouldApplyPeriodAggregateResponse/);
});

test('new period tab appears from aggregate without reload', () => {
  assert.match(pageSource, /available_periods\.includes\(periodKey\)/);
  assert.match(pageSource, /\[\.\.\.current\.available_periods, periodKey\]\.sort\(\)/);
  assert.doesNotMatch(pageSource, /window\.location\.reload|location\.href\s*=/);
});

test('Enter is non-blocking commit; 500ms autosave remains', () => {
  assert.match(viewSource, /scheduleCustomCellAutosave/);
  assert.match(viewSource, /,\s*500\s*\)/);
  assert.match(viewSource, /void flushCustomCellKey\(key\)/);
  assert.match(viewSource, /void commitCustomCellEdit/);
  assert.match(viewSource, /event\.key === 'Enter'/);
  assert.doesNotMatch(viewSource, /await flushCustomCellKey/);
  assert.doesNotMatch(viewSource, /await commitCustomCellEdit/);
});

test('four Hebrew status paint modes with swatches and mutually exclusive active', () => {
  assert.match(viewSource, /manualStatusPaintModes/);
  assert.match(viewSource, /nx-co-sheet__status-mode/);
  assert.match(viewSource, /setStatusPaintMode\(\(current\) => \(current === mode\.id \? null : mode\.id\)\)/);
  assert.match(cssSource, /\.nx-co-sheet__status-mode\s*\{[^}]*height:\s*34px/s);
  assert.match(cssSource, /nx-co-sheet__status-mode-swatch/);
  assert.match(cssSource, /is-manual-status-ready/);
  assert.match(cssSource, /is-manual-status-sent_for_approval/);
  assert.match(cssSource, /is-manual-status-completed/);
});

test('paint uses backend capabilities; no DOM square counting', () => {
  assert.match(viewSource, /manual_cell_statuses/);
  assert.match(viewSource, /allowed_statuses/);
  assert.match(viewSource, /set_client_operations_cell_manual_status/);
  assert.match(viewSource, /paintCellManualStatus/);
  assert.match(viewSource, /tryStartManualStatusPaint/);
  assert.match(viewSource, /completeManualStatusPaintSuccess/);
  assert.doesNotMatch(viewSource, /querySelectorAll|getElementsByClassName|children\.length/);
});

test('paint mode does not invoke checkbox/date canonical commands', () => {
  assert.match(viewSource, /if \(statusPaintMode\) return;/);
  assert.match(viewSource, /toggleMaterialStream/);
  assert.match(viewSource, /toggleNiDeductionsItem/);
  assert.match(viewSource, /toggleIncomeTaxDeductions/);
  assert.match(viewSource, /setOperationalTargetDate/);
  assert.match(viewSource, /if \(statusPaintMode\) \{\s*event\.preventDefault\(\);\s*paintCellManualStatus/s);
});

test('org change clears period aggregate cache', () => {
  assert.match(pageSource, /periodCacheRef\.current\.clear\(\)/);
  assert.match(pageSource, /activeOrganizationId/);
  assert.match(pageSource, /backendAvailablePeriodsRef/);
});
