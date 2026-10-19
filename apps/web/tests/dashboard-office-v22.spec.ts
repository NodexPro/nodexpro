/**
 * Dashboard V2.2: compact three-column layout, fee-attention list,
 * preserved glass and five KPIs.
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
const officeCopy = readFileSync(join(dir, '../../api/src/domains/dashboard/dashboard-office-copy.pure.ts'), 'utf8');
const officeProvider = readFileSync(
  join(dir, '../../api/src/domains/dashboard/providers/dashboard-office.provider.ts'),
  'utf8',
);
const breakdownPure = readFileSync(
  join(dir, '../../api/src/domains/dashboard/dashboard-office-fee-breakdown.pure.ts'),
  'utf8',
);

test('five KPI cards remain and New clients is not duplicated as a section', () => {
  assert.match(dashSrc, /office\.kpis\.active_clients/);
  assert.match(dashSrc, /office\.kpis\.expected_fees/);
  assert.match(dashSrc, /office\.kpis\.office_debtors/);
  assert.match(dashSrc, /office\.kpis\.new_clients/);
  assert.match(dashSrc, /office\.kpis\.clients_left/);
  assert.match(dashCss, /repeat\(5, minmax\(0, 1fr\)\)/);
  assert.equal((dashSrc.match(/office\.kpis\.new_clients/g) ?? []).length, 1);
  assert.doesNotMatch(dashSrc, /label="New clients"/);
});

test('second and third desktop rows are equal three-column grids that wrap on narrower screens', () => {
  assert.match(dashSrc, /data-testid="nx-dashboard-row-attention"/);
  assert.match(dashSrc, /data-testid="nx-dashboard-row-charts"/);
  assert.match(dashSrc, /nx-dashboard__row--triple/);
  assert.match(dashSrc, /office\.missing_fees/);
  assert.match(dashSrc, /office\.attention/);
  assert.match(dashSrc, /office\.deadlines/);
  assert.match(dashSrc, /office\.charts\.client_growth/);
  assert.match(dashSrc, /office\.client_status/);
  assert.match(dashSrc, /office\.charts\.expected_fees_by_month/);
  assert.doesNotMatch(dashSrc, /office\.quick_actions\.actions/);
  assert.match(dashCss, /\.nx-dashboard__row--triple \{[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(
    dashCss,
    /@media \(max-width: 1100px\) \{[\s\S]*\.nx-dashboard__row--triple \{[\s\S]*grid-template-columns: 1fr/,
  );
  assert.match(dashCss, /overflow-x: hidden/);
});

test('glass recipe is unchanged while only grid placement is adjusted', () => {
  assert.match(dashCss, /linear-gradient\(180deg, rgba\(248, 252, 255, 0\.2\)/);
  assert.match(dashCss, /backdrop-filter: blur\(12px\)/);
  assert.match(dashCss, /border-radius: 14px/);
  assert.match(dashCss, /rgba\(70, 213, 255/);
  assert.doesNotMatch(dashCss, /background:\s*#FFFFFF/);
  assert.doesNotMatch(dashSrc, /background: '#F8FAFC'/);
});

test('view-all uses the backend fee_attention filter and does not page clients in React', () => {
  assert.match(dashSrc, /view_all_filter/);
  assert.match(dashSrc, /fee_attention/);
  assert.doesNotMatch(dashSrc, /needs_configuration/);
  assert.doesNotMatch(dashSrc, /office\.missing_fees\.clients\.filter/);
  assert.doesNotMatch(modalSrc, /slice\(0,\s*pageSize\)|clients\.filter\(/);
  assert.match(modalSrc, /page_size/);
  assert.match(breakdownPure, /FEE_ATTENTION_PREVIEW_CAP = 5/);
  assert.match(officeProvider, /selectFeeAttentionClients/);
});

test('empty fee-attention copy and distinct zero/no-agreement labels stay backend-owned', () => {
  assert.match(officeCopy, /לכל הלקוחות הוגדר שכ״ט/);
  assert.match(officeCopy, /שכ״ט 0 ₪/);
  assert.match(officeCopy, /לא הוגדר הסכם שכ״ט/);
  assert.match(officeCopy, /Upcoming reports/);
  assert.match(officeProvider, /attentionIndicatorHe/);
  assert.match(officeProvider, /indicator_zero_fee/);
});

test('charts sit in the triple row and do not invent historical expected-fee series', () => {
  assert.match(dashSrc, /occupyFeeChart/);
  assert.match(dashSrc, /historical_basis_he/);
  assert.match(dashSrc, /<LineChart points=\{feePoints\} compact \/>/);
  assert.doesNotMatch(dashSrc, /fabricate|projectedBackward|expectedAmount \*/);
});
