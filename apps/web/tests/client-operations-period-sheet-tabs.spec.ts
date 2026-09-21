/**
 * Client Operations Phase 2 — month tabs / period label presentation (pure + source contracts).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildClientOperationsOperationalPeriodKey,
  formatClientOperationsOperationalPeriodTabLabel,
  isClientOperationsOperationalPeriodKey,
  parseClientOperationsOperationalPeriodKey,
} from '../src/lib/client-operations-operational-period-label.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));

test('period tab label is presentation-only MM.YY', () => {
  assert.equal(formatClientOperationsOperationalPeriodTabLabel('2026-09'), '09.26');
  assert.equal(formatClientOperationsOperationalPeriodTabLabel('2027-01'), '01.27');
  assert.equal(buildClientOperationsOperationalPeriodKey(8, 2026), '2026-08');
  assert.equal(isClientOperationsOperationalPeriodKey('2026-08'), true);
  assert.equal(isClientOperationsOperationalPeriodKey('08.26'), false);
  assert.deepEqual(parseClientOperationsOperationalPeriodKey('2026-08'), { year: 2026, month: 8 });
});

test('page default/available periods and period switch come from backend aggregate', () => {
  const page = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
  assert.match(page, /period\.selected_period_key|data\.period\?\.selected_period_key/);
  assert.match(page, /available_periods/);
  assert.match(page, /default_period_key/);
  assert.match(page, /onPeriodChange/);
  assert.match(page, /operational_period_key/);
  assert.match(page, /loadSeqRef/);
  assert.match(page, /AbortController/);
  assert.doesNotMatch(page, /for\s*\(.*month.*12/);
  assert.doesNotMatch(page, /new Date\(\)\.getMonth/);
});

test('search/sort preserve selected operational_period_key', () => {
  const page = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
  assert.match(page, /operational_period_key:\s*query\.operational_period_key/);
});

test('commands include selected period query; material command is period-scoped', () => {
  const page = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
  const view = readFileSync(
    join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
    'utf8',
  );
  assert.match(page, /\{\s*\.\.\.body,\s*query\s*\}/);
  assert.match(view, /set_material_brought/);
  assert.match(view, /operational_period_key:\s*query\?\.operational_period_key/);
});

test('month tabs render backend available_periods; + opens period without cloning table', () => {
  const tabs = readFileSync(
    join(dir, '../src/components/client-operations/ClientOperationsPeriodSheetTabs.tsx'),
    'utf8',
  );
  const view = readFileSync(
    join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
    'utf8',
  );
  assert.match(tabs, /availablePeriods/);
  assert.match(tabs, /onSelectPeriod/);
  assert.match(tabs, /פתח/);
  assert.match(view, /ClientOperationsPeriodSheetTabs/);
  assert.match(view, /fullscreenOpen/);
  assert.ok((view.match(/ClientOperationsPeriodSheetTabs/g) || []).length >= 2);
  assert.doesNotMatch(tabs, /cloneTable|duplicateTable|createTable/);
});

test('NOT APPLICABLE material is visually distinct from unchecked', () => {
  const view = readFileSync(
    join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
    'utf8',
  );
  assert.match(view, /nx-co-sheet__na/);
  assert.match(view, /material_brought_cell\?\.applicable/);
  assert.match(view, /לא רלוונטי לתקופה זו/);
  assert.match(view, /obligationApplicable/);
});

test('no FE applicability / VAT frequency / legal-date math', () => {
  const view = readFileSync(
    join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
    'utf8',
  );
  const page = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
  const tabs = readFileSync(
    join(dir, '../src/components/client-operations/ClientOperationsPeriodSheetTabs.tsx'),
    'utf8',
  );
  for (const src of [view, page, tabs]) {
    assert.doesNotMatch(src, /computeOperationalPeriodApplicability|isVatBiMonthlyApplicable/);
    assert.doesNotMatch(src, /vat_frequency\s*===\s*['\"]bi_monthly['\"]/);
    assert.doesNotMatch(src, /annual_report_due|capital_declaration_due/);
  }
});

test('folder / widths / custom columns contracts preserved across period UI', () => {
  const view = readFileSync(
    join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
    'utf8',
  );
  assert.match(view, /📁/);
  assert.match(view, /loadClientOperationsColumnWidths|saveClientOperationsColumnWidths/);
  assert.doesNotMatch(view, /column-widths.*operational_period|operational_period.*column-widths/);
});

test('default aggregate 2026-08 renders active tab label 08.26', () => {
  assert.equal(formatClientOperationsOperationalPeriodTabLabel('2026-08'), '08.26');
  const tabs = readFileSync(
    join(dir, '../src/components/client-operations/ClientOperationsPeriodSheetTabs.tsx'),
    'utf8',
  );
  // Active tab is selectedPeriodKey from backend aggregate — not FE "today".
  assert.match(tabs, /key === selectedPeriodKey/);
  assert.doesNotMatch(tabs, /businessMonthKey|getMonth\(\)|defaultPeriodKey\s*===\s*key/);
});

test('09.26 may appear in available periods but is not auto-active', () => {
  const tabs = readFileSync(
    join(dir, '../src/components/client-operations/ClientOperationsPeriodSheetTabs.tsx'),
    'utf8',
  );
  const page = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
  assert.match(tabs, /availablePeriods/);
  assert.match(tabs, /selectedPeriodKey/);
  // Page trusts backend selected_period_key; does not prefer calendar month.
  assert.match(page, /selected_period_key/);
  assert.doesNotMatch(page, /new Date\(\)\.getMonth|businessMonthKey/);
});

test('clicking a tab requests that operational_period_key only', () => {
  const tabs = readFileSync(
    join(dir, '../src/components/client-operations/ClientOperationsPeriodSheetTabs.tsx'),
    'utf8',
  );
  assert.match(tabs, /onSelectPeriod\(key\)/);
  assert.match(tabs, /onSelectPeriod\(key\)/);
});

test('FE does not filter registry rows by row_visible / applicability', () => {
  const view = readFileSync(
    join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
    'utf8',
  );
  const page = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
  assert.doesNotMatch(view, /row_visible\s*===\s*false|!.*row_visible/);
  assert.doesNotMatch(page, /row_visible/);
  assert.doesNotMatch(view, /rows\.filter\(/);
});

test('sheet tab strip is compact; native scrollbar ▲▼ buttons are suppressed', () => {
  const css = readFileSync(
    join(dir, '../src/styles/nx-client-operations-spreadsheet.css'),
    'utf8',
  );
  assert.match(css, /\.nx-co-sheet__period-tabs-scroll\s*\{[^}]*overflow-y:\s*hidden/s);
  assert.match(css, /\.nx-co-sheet__period-tabs-scroll\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.nx-co-sheet__canvas\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.nx-co-sheet__canvas\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /::-webkit-scrollbar-button\s*\{[^}]*display:\s*none/s);
  assert.doesNotMatch(css, /fake-scroll|scroll-arrow|nx-co-sheet__scroll-btn/);
});

test('חומר column renders three backend-driven subcontrols מע״מ / מה״כ / שכר', () => {
  const view = readFileSync(
    join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
    'utf8',
  );
  const css = readFileSync(
    join(dir, '../src/styles/nx-client-operations-spreadsheet.css'),
    'utf8',
  );
  assert.match(view, /material_cells/);
  assert.match(view, /set_material_brought/);
  assert.match(view, /set_income_tax_advance_material_brought/);
  assert.match(view, /set_payroll_material_brought/);
  assert.match(view, /nx-co-sheet__material-header-title/);
  assert.match(view, />חומר</);
  assert.match(view, /מע״מ/);
  assert.match(view, /מה״כ/);
  assert.match(view, /שכר/);
  assert.match(view, /material_cells\?\.vat|cells\?\.vat/);
  assert.match(view, /income_tax_advance/);
  assert.match(view, /payroll/);
  assert.match(view, /\.applicable/);
  assert.match(css, /\.nx-co-sheet__material\s*\{/);
  assert.match(css, /\.nx-co-sheet__material-slot\.is-na/);
  assert.doesNotMatch(view, /vat_frequency|isVatBiMonthlyApplicable/);
  assert.doesNotMatch(view, /income_tax_advance_frequency/);
  assert.doesNotMatch(view, /mapOperationalPeriodKeyToPayrollPeriodKey|businessPreviousMonthKey/);
});

