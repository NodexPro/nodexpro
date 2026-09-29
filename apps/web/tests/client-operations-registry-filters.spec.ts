/**
 * Client Operations — filter bar FE architecture (render-only, no business inference).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const viewSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const pageSource = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
const endpointsSource = readFileSync(join(dir, '../src/api/endpoints.ts'), 'utf8');
const cssSource = readFileSync(
  join(dir, '../src/styles/nx-client-operations-spreadsheet.css'),
  'utf8',
);

test('separate filter bar strip exists below toolbar', () => {
  assert.match(viewSource, /nx-co-sheet__filter-bar/);
  assert.match(viewSource, /renderFilterBar\(\)/);
  assert.match(viewSource, /\{renderSpreadsheetToolbar\(\)\}[\s\S]*\{renderFilterBar\(\)\}/);
  assert.match(cssSource, /\.nx-co-sheet__filter-bar\b/);
  assert.match(viewSource, /נקה סינון/);
});

test('filter definitions rendered from aggregate — no FE option construction', () => {
  assert.match(viewSource, /filters\?\.definitions/);
  assert.match(viewSource, /def\.options\.map/);
  assert.doesNotMatch(viewSource, /עוסק מורשה[\s\S]{0,80}option/);
  assert.doesNotMatch(pageSource, /filter_options\s*=\s*\[/);
});

test('no frontend business filtering / inference', () => {
  // Allow generic Array methods outside business filter logic; forbid domain filter patterns.
  assert.doesNotMatch(viewSource, /rows\.filter\s*\(/);
  assert.doesNotMatch(viewSource, /manualRows\.filter\s*\(/);
  assert.doesNotMatch(viewSource, /TABLE_COLUMNS\.match/);
  assert.doesNotMatch(viewSource, /statusToUi/);
  assert.doesNotMatch(viewSource, /if\s*\(\s*column\s*===\s*['"]vat['"]/);
  assert.doesNotMatch(viewSource, /if\s*\(\s*business_type/);
  assert.doesNotMatch(viewSource, /if\s*\(\s*payroll/);
  assert.doesNotMatch(viewSource, /if\s*\(\s*vat_frequency/);
  assert.doesNotMatch(viewSource, /if\s*\(\s*income_tax/);
  assert.doesNotMatch(viewSource, /background.*green|getComputedStyle|#22c55e|#16a34a/i);
  assert.doesNotMatch(pageSource, /rows\.filter\s*\(/);
});

test('filter query params forwarded on registry GET', () => {
  assert.match(endpointsSource, /filter_operational_reporting/);
  assert.match(endpointsSource, /filter_material/);
  assert.match(endpointsSource, /filter_payroll/);
  assert.match(endpointsSource, /filter_reporting_type/);
  assert.match(endpointsSource, /filter_business_type/);
  assert.match(endpointsSource, /filter_handler/);
  assert.match(pageSource, /filter_operational_reporting/);
  assert.match(pageSource, /loadSeqRef/);
});

test('filter change is quiet aggregate read — not a write command', () => {
  assert.match(viewSource, /applyBusinessFilterChange/);
  assert.match(viewSource, /onQueryChange\(/);
  assert.doesNotMatch(viewSource, /applyBusinessFilterChange[\s\S]{0,200}onRegistryCommand/);
  assert.match(viewSource, /clearBusinessFilters/);
});
