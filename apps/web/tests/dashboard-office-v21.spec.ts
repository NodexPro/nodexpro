/**
 * Dashboard V2.1: fifth KPI, fee-breakdown modal, compact layout,
 * no frontend financial stitching, glass modal (not nx-modal).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const dashSrc = readFileSync(join(dir, '../src/pages/Dashboard.tsx'), 'utf8');
const dashCss = readFileSync(join(dir, '../src/styles/nx-dashboard.css'), 'utf8');
const modalSrc = readFileSync(join(dir, '../src/components/dashboard/DashboardFeeBreakdownModal.tsx'), 'utf8');
const endpoints = readFileSync(join(dir, '../src/api/endpoints.ts'), 'utf8');
const officeProvider = readFileSync(
  join(dir, '../../api/src/domains/dashboard/providers/dashboard-office.provider.ts'),
  'utf8',
);
const officeCopy = readFileSync(join(dir, '../../api/src/domains/dashboard/dashboard-office-copy.pure.ts'), 'utf8');
const routesSrc = readFileSync(join(dir, '../../api/src/domains/dashboard/dashboard.routes.ts'), 'utf8');
const feesPure = readFileSync(join(dir, '../../api/src/domains/dashboard/dashboard-office-fees.pure.ts'), 'utf8');
const churnPure = readFileSync(join(dir, '../../api/src/domains/dashboard/dashboard-office-churn.pure.ts'), 'utf8');
const breakdownPure = readFileSync(
  join(dir, '../../api/src/domains/dashboard/dashboard-office-fee-breakdown.pure.ts'),
  'utf8',
);

test('five KPI cards stay in the dashboard and include clients who left', () => {
  assert.match(dashSrc, /office\.kpis\.active_clients/);
  assert.match(dashSrc, /office\.kpis\.expected_fees/);
  assert.match(dashSrc, /office\.kpis\.office_debtors/);
  assert.match(dashSrc, /office\.kpis\.new_clients/);
  assert.match(dashSrc, /office\.kpis\.clients_left/);
  assert.match(officeCopy, /לקוחות שעזבו/);
  assert.match(officeCopy, /Clients who left/);
  assert.match(dashCss, /repeat\(5, minmax\(0, 1fr\)\)/);
});

test('expected-fees KPI opens a backend-owned breakdown modal rather than stitching per-client GETs', () => {
  assert.match(dashSrc, /DashboardFeeBreakdownModal/);
  assert.match(dashSrc, /open_fee_breakdown/);
  assert.match(modalSrc, /dashboardOfficeFeeBreakdown\(\)/);
  assert.match(modalSrc, /page_size/);
  assert.match(modalSrc, /sort_dir/);
  assert.match(endpoints, /dashboard\/office-fee-breakdown/);
  assert.doesNotMatch(modalSrc, /slice\(0,\s*pageSize\)|clients\.filter\(/);
  assert.doesNotMatch(dashSrc, /projectClientExpectedFee|monthlyEquivalentBeforeVat/);
});

test('fee breakdown modal reuses dashboard glass and is not a second white modal system', () => {
  assert.match(modalSrc, /nx-dashboard-breakdown-overlay/);
  assert.match(modalSrc, /onClose/);
  assert.match(modalSrc, /onOpenClient/);
  assert.match(modalSrc, /Escape/);
  assert.doesNotMatch(modalSrc, /nx-modal/);
  assert.match(dashCss, /\.nx-dashboard-breakdown \{[\s\S]*rgba\(248, 252, 255, 0\.2\)/);
  assert.match(dashCss, /\.nx-dashboard-breakdown \{[\s\S]*backdrop-filter: blur\(12px\)/);
  assert.doesNotMatch(dashCss, /\.nx-dashboard-breakdown \{[\s\S]*background:\s*#0[0-9a-f]{5}/);
});

test('breakdown route is authenticated, org-scoped, and paginated on the server', () => {
  assert.match(routesSrc, /\/office-fee-breakdown/);
  assert.match(routesSrc, /getOfficeFeeBreakdown/);
  assert.match(officeProvider, /authorizedSet/);
  assert.match(officeProvider, /paginateFeeBreakdown/);
  assert.match(officeProvider, /tab=fees/);
  assert.match(breakdownPure, /page_size/);
  assert.match(breakdownPure, /needs_configuration/);
});

test('churn uses ended_at and does not invent a historical denominator from today\'s headcount', () => {
  assert.match(churnPure, /ended_at/);
  assert.match(churnPure, /population_at_start/);
  assert.match(churnPure, /created_at/);
  assert.doesNotMatch(churnPure, /activeClients\.length/);
});

test('previous-month fees and year-to-date expected fees stay unavailable without fee-history reconstruction', () => {
  assert.match(feesPure, /historical_unavailable/);
  assert.match(officeProvider, /kpi_expected_year_unavailable/);
  assert.match(officeCopy, /אין סכום שנתי מהימן/);
  assert.doesNotMatch(officeProvider, /expectedAmount \* elapsed|created_at.*agreement_start/);
});
