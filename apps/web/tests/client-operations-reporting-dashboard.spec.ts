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
  assert.equal(typeof (enReporting.kpi as { paymentsOutstanding: string }).paymentsOutstanding, 'string');
  assert.equal(typeof (heReporting.kpi as { paymentsOutstanding: string }).paymentsOutstanding, 'string');
  assert.equal(typeof (enReporting.payment as { question: string }).question, 'string');
  assert.equal(typeof (heReporting.payment as { question: string }).question, 'string');
  const dashSlice = viewSource.slice(
    viewSource.indexOf('const renderReportingDashboard'),
    viewSource.indexOf('const renderFilterBar'),
  );
  assert.doesNotMatch(dashSlice, /[\u0590-\u05FF]/);
});
