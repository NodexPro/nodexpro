/**
 * Client Operations reporting dashboard — dumb UI over backend aggregate.
 * Status, priority, KPI counts and previous-period facts must not be computed in the browser.
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
const en = JSON.parse(readFileSync(join(dir, '../src/i18n/en.json'), 'utf8')) as {
  clientOperations: { registry: { reporting: Record<string, unknown> } };
};
const he = JSON.parse(readFileSync(join(dir, '../src/i18n/he.json'), 'utf8')) as {
  clientOperations: { registry: { reporting: Record<string, unknown> } };
};

test('registry GET carries KPI filter; dashboard comes from aggregate only', () => {
  assert.match(endpointsSource, /filter_reporting_kpi/);
  assert.match(pageSource, /reporting_dashboard/);
  assert.match(pageSource, /setReportingDashboard\(data\?\.reporting_dashboard/);
  assert.match(pageSource, /reportingDashboard=\{reportingDashboard\}/);
  assert.match(viewSource, /data-testid="client-operations-reporting-dashboard"/);
  assert.doesNotMatch(viewSource, /CLIENT_OPERATIONS_REPORTING_WARNING_DAYS/);
  assert.doesNotMatch(viewSource, /days_until_due\s*[<>=]/);
  assert.doesNotMatch(pageSource, /open_overdue_count\s*\+/);
});

test('KPI click is a quiet query change, filing mark is a named command', () => {
  assert.match(viewSource, /filter_reporting_kpi:\s*selected \? null : card\.id/);
  assert.match(viewSource, /mark_client_operations_obligation_reported/);
  assert.match(viewSource, /mark_client_operations_obligation_not_reported/);
  assert.match(viewSource, /confirm_client_operations_obligation_filed_with_payment/);
  assert.match(viewSource, /confirm_client_operations_obligation_tax_payment/);
  assert.match(viewSource, /obligation_id:\s*reportingCell\.obligation_id/);
  assert.doesNotMatch(viewSource, /PATCH/);
});

test('row/cell tones, overdue marker, KPI and previous-period chrome exist', () => {
  assert.match(viewSource, /is-reporting-row-\$\{row\.reporting\.row_tone\}/);
  assert.match(viewSource, /is-reporting-cell-\$\{reportingCell\.tone\}/);
  assert.match(viewSource, /nx-co-sheet__reporting-overdue/);
  assert.match(viewSource, /onPeriodChange\?\.\(item\.navigate_period_key\)/);
  assert.match(cssSource, /\.nx-co-sheet__reporting-dash\b/);
  assert.match(cssSource, /\.nx-co-sheet__table tbody tr\.is-reporting-row-complete td/);
  assert.match(cssSource, /\.nx-co-sheet__table tbody td\.is-reporting-cell-overdue/);
  assert.match(cssSource, /\.nx-co-sheet__table tbody td\.is-reporting-cell-payment_outstanding/);
});

test('payment modal is Create Client-styled, has no Yes preselect, and cancel does not file', () => {
  assert.match(viewSource, /data-testid="client-operations-payment-modal"/);
  assert.match(viewSource, /data-testid="client-operations-filing-paid"/);
  assert.match(viewSource, /detail\.can_mark_paid/);
  assert.match(viewSource, /!canAct \|\| !detail\.can_mark_paid/);
  assert.match(viewSource, /nx-client-create--deep-ocean-glass/);
  assert.match(viewSource, /selected: null/);
  assert.match(viewSource, /disabled=\{!paymentModal\.selected\}/);
  assert.match(viewSource, /setPaymentModal\(null\)/);
  assert.match(viewSource, /reportingCell\?\.overlay_visible/);
  assert.doesNotMatch(viewSource, /\['vat', 'income_tax_advance'/);
  assert.match(viewSource, /data-testid="client-operations-payments-outstanding-kpi"/);
  assert.doesNotMatch(viewSource, /mark_obligation_reported_and_paid/);
});

test('EN/HE reporting dashboard keys exist without hardcoded Hebrew chrome in the new strip', () => {
  const enReporting = en.clientOperations.registry.reporting;
  const heReporting = he.clientOperations.registry.reporting;
  assert.equal(typeof enReporting.previousIncomplete, 'string');
  assert.equal(typeof heReporting.previousIncomplete, 'string');
  assert.equal(typeof (enReporting.kpi as { vat: string }).vat, 'string');
  assert.equal(typeof (heReporting.kpi as { vat: string }).vat, 'string');
  assert.equal((enReporting.kpi as { incomeTax: string }).incomeTax, 'Income-tax advances');
  assert.equal((heReporting.kpi as { incomeTax: string }).incomeTax, 'מקדמות מס הכנסה');
  assert.equal(typeof (enReporting.kpi as { incomeTaxDeductions: string }).incomeTaxDeductions, 'string');
  assert.equal(typeof (heReporting.kpi as { incomeTaxDeductions: string }).incomeTaxDeductions, 'string');
  assert.equal(typeof (enReporting.kpi as { nationalInsuranceDeductions: string }).nationalInsuranceDeductions, 'string');
  assert.equal(typeof (heReporting.kpi as { nationalInsuranceDeductions: string }).nationalInsuranceDeductions, 'string');
  assert.equal(typeof (enReporting.kpi as { capitalDeclaration: string }).capitalDeclaration, 'string');
  assert.equal(typeof (heReporting.kpi as { capitalDeclaration: string }).capitalDeclaration, 'string');
  assert.match((heReporting.kpi as { capitalDeclaration: string }).capitalDeclaration, /[\u0590-\u05FF]/);
  assert.equal(typeof (enReporting.kpi as { paymentsOutstanding: string }).paymentsOutstanding, 'string');
  assert.equal(typeof (heReporting.kpi as { paymentsOutstanding: string }).paymentsOutstanding, 'string');
  assert.equal(typeof (enReporting.payment as { question: string }).question, 'string');
  assert.equal(typeof (heReporting.payment as { question: string }).question, 'string');
  assert.equal(typeof (enReporting.cell as { informational: string }).informational, 'string');
  assert.equal(typeof (heReporting.cell as { informational: string }).informational, 'string');
  assert.equal(typeof (enReporting.period as { monthly: string; bimonthly: string }).monthly, 'string');
  assert.equal(typeof (heReporting.period as { monthly: string; bimonthly: string }).bimonthly, 'string');
  assert.match((enReporting.cell as { informational: string }).informational, /Informational/);
  assert.match((heReporting.cell as { informational: string }).informational, /[\u0590-\u05FF]/);
  const dashSlice = viewSource.slice(
    viewSource.indexOf('const renderReportingDashboard'),
    viewSource.indexOf('const renderFilterBar'),
  );
  assert.doesNotMatch(dashSlice, /[\u0590-\u05FF]/);
  assert.doesNotMatch(dashSlice, /card\.remaining_count/);
  assert.match(dashSlice, /card\.submitted_count/);
  assert.match(dashSlice, /card\.total_count/);
});

test('10.26 row chrome renders backend tones; previous KPI overdue is not applied to rows', () => {
  assert.match(viewSource, /is-reporting-row-\$\{row\.reporting\.row_tone\}/);
  assert.match(viewSource, /is-reporting-cell-\$\{reportingCell\.tone\}/);
  assert.match(viewSource, /previous\.overdue_count/);
  const rowClassSlice = viewSource.slice(
    viewSource.indexOf('is-reporting-row-${row.reporting.row_tone}'),
    viewSource.indexOf('is-reporting-row-${row.reporting.row_tone}') + 200,
  );
  assert.doesNotMatch(rowClassSlice, /previous\.overdue/);
  assert.match(viewSource, /obligation_id:\s*reportingCell\.obligation_id/);
  assert.doesNotMatch(viewSource, /computeNextVatDivuachDueDate/);
  assert.doesNotMatch(viewSource, /19 לחודש|23 לחודש/);
});

test('EN/HE reporting strings and RTL/LTR follow the selected language', () => {
  const i18nSource = readFileSync(join(dir, '../src/i18n/I18nProvider.tsx'), 'utf8');
  assert.match(i18nSource, /document\.documentElement\.dir = lang === 'he' \? 'rtl' : 'ltr'/);
  assert.match(viewSource, /dir=\{lang === 'he' \? 'rtl' : 'ltr'\}/);
  assert.match(cssSource, /max-width:\s*100%/);
  const enPeriod = (en.clientOperations.registry.reporting as { period: { monthly: string; bimonthly: string } }).period;
  const hePeriod = (he.clientOperations.registry.reporting as { period: { monthly: string; bimonthly: string } }).period;
  assert.equal(enPeriod.monthly, '{{period}}');
  assert.equal(hePeriod.bimonthly, '{{start}}–{{end}}');
  assert.match((en.clientOperations.registry.reporting as { cell: { informational: string } }).cell.informational, /Informational/);
  assert.match((he.clientOperations.registry.reporting as { cell: { informational: string } }).cell.informational, /[\u0590-\u05FF]/);
});

test('reporting KPI cards stay presentation-only:  submitted/total, wrap, no remaining line', () => {
  const dashSlice = viewSource.slice(
    viewSource.indexOf('const renderReportingDashboard'),
    viewSource.indexOf('const renderFilterBar'),
  );
  assert.match(dashSlice, /card\.submitted_count/);
  assert.match(dashSlice, /card\.total_count/);
  assert.doesNotMatch(dashSlice, /card\.remaining_count/);
  assert.doesNotMatch(dashSlice, /t\(.*remaining/);
  assert.doesNotMatch(viewSource, /submitted_count\s*\+/);
  assert.doesNotMatch(viewSource, /total_count\s*-/);
  assert.match(cssSource, /\.nx-co-sheet__reporting-kpis[\s\S]*?grid-template-columns:\s*repeat\(auto-fit/);
  assert.doesNotMatch(cssSource, /\.nx-co-sheet__reporting-kpis[\s\S]*?overflow-x:\s*auto/);
});
