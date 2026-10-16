/**
 * Dashboard navy-glass presentation + metric ownership (no invented revenue).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const dashSrc = readFileSync(join(dir, '../src/pages/Dashboard.tsx'), 'utf8');
const dashCss = readFileSync(join(dir, '../src/styles/nx-dashboard.css'), 'utf8');
const layoutSrc = readFileSync(join(dir, '../src/templates/template-1/TemplateLayout.tsx'), 'utf8');
const coProvider = readFileSync(
  join(dir, '../../api/src/domains/dashboard/providers/dashboard-client-operations.provider.ts'),
  'utf8',
);

test('Dashboard uses navy glass cards and keeps the four metric slots', () => {
  assert.match(dashSrc, /nx-dashboard\.css/);
  assert.match(dashSrc, /data-testid="nx-dashboard"/);
  assert.match(dashSrc, /label="New clients"/);
  assert.match(dashSrc, /label="Active Total clients"/);
  assert.match(dashSrc, /label="Debtors"/);
  assert.match(dashSrc, /label="Total revenue"/);
  assert.match(dashCss, /\.nx-dashboard-card/);
  assert.match(dashCss, /linear-gradient\(180deg, rgba\(248, 252, 255, 0\.2\)/);
  assert.match(dashCss, /font-family: Arial, sans-serif/);
  assert.doesNotMatch(dashSrc, /background: '#FFFFFF'/);
  assert.doesNotMatch(dashSrc, /background: '#F8FAFC'/);
});

test('Dashboard presentation drops the redundant name/language header only on /dashboard', () => {
  assert.match(layoutSrc, /const isDashboard = location\.pathname === '\/dashboard'/);
  assert.match(layoutSrc, /isUsersRolesWorkspace \|\| isDashboard \? null/);
  assert.match(layoutSrc, /isNavyNativeSurface = isClientOperationsModule \|\| isUsersRolesWorkspace \|\| isDashboard/);
  assert.match(layoutSrc, /<AppHeader/);
  assert.match(layoutSrc, /onSetLanguage=\{onSetUiLanguage\}/);
});

test('TOTAL REVENUE stays unavailable unless Accounting Base marks monthly_revenue ready', () => {
  assert.match(dashSrc, /summary\.monthly_revenue_status === 'ready'/);
  assert.match(dashSrc, /Office-earned revenue is not available yet/);
  assert.match(dashSrc, /Accounting Base does not expose this metric/);
  assert.doesNotMatch(dashSrc, /monthly_revenue\.amount\s*\+|sumInvoices|total_revenue\s*=/);
  assert.match(coProvider, /monthly_revenue_status: 'coming_soon'/);
  assert.match(coProvider, /monthly_revenue: null/);
});
