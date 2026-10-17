/**
 * Office Dashboard V2: bilingual glass layout, aggregate-owned metrics,
 * no invented cash / debtor / deadline figures.
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
const caseSrc = readFileSync(join(dir, '../src/pages/ClientOperationsClientCase.tsx'), 'utf8');
const officeProvider = readFileSync(
  join(dir, '../../api/src/domains/dashboard/providers/dashboard-office.provider.ts'),
  'utf8',
);
const officeCopy = readFileSync(
  join(dir, '../../api/src/domains/dashboard/dashboard-office-copy.pure.ts'),
  'utf8',
);
const feesPure = readFileSync(join(dir, '../../api/src/domains/dashboard/dashboard-office-fees.pure.ts'), 'utf8');
const routesSrc = readFileSync(join(dir, '../../api/src/domains/dashboard/dashboard.routes.ts'), 'utf8');

test('Dashboard V2 renders aggregate labels and follows application language direction', () => {
  assert.match(dashSrc, /useI18n\(\)/);
  assert.match(dashSrc, /dir=\{dir\}/);
  assert.match(dashSrc, /office\.title_he/);
  assert.match(dashSrc, /office\.missing_fees/);
  assert.match(dashSrc, /office\.attention/);
  assert.match(officeCopy, /סקירת המשרד/);
  assert.match(officeCopy, /לקוחות ללא שכ״ט מוגדר/);
  assert.match(officeCopy, /הכנסה חודשית צפויה משכ״ט/);
  assert.match(officeCopy, /משימות דורשות תשומת לב/);
  assert.match(officeCopy, /הדיווחים הקרובים/);
  assert.match(officeCopy, /צמיחת לקוחות/);
  assert.match(officeCopy, /פעולות מהירות/);
  assert.match(officeCopy, /Expected monthly office fees/);
  assert.match(dashCss, /font-family: Arial, sans-serif/);
  assert.match(dashCss, /\[dir='rtl'\]/);
  assert.match(dashCss, /\[dir='ltr'\]/);
  assert.doesNotMatch(dashCss, /^\.nx-dashboard \{[\s\S]*direction: rtl/m);
  assert.doesNotMatch(dashSrc, /background: '#FFFFFF'/);
  assert.doesNotMatch(dashSrc, /label="New clients"/);
  assert.doesNotMatch(dashSrc, /label="Total revenue"/);
});

test('Dashboard V2 keeps global header/language off the dashboard surface only', () => {
  assert.match(layoutSrc, /const isDashboard = location\.pathname === '\/dashboard'/);
  assert.match(layoutSrc, /isUsersRolesWorkspace \|\| isDashboard \? null/);
  assert.match(layoutSrc, /<AppHeader/);
});

test('Dashboard V2 reads one overview aggregate with period and locale and does not stitch extra GETs', () => {
  assert.match(dashSrc, /dashboardOverview\(\)/);
  assert.match(dashSrc, /period=/);
  assert.match(dashSrc, /locale=/);
  assert.doesNotMatch(dashSrc, /moduleClientOperationsCase|fetchWorkEngineQueueAggregate|\/fees/);
  assert.match(routesSrc, /req\.query\.period/);
  assert.match(routesSrc, /req\.query\.locale/);
});

test('Expected fees stay before VAT, exclude one-time, and do not invent cash collected', () => {
  assert.match(feesPure, /line\.charging_type\) === 'one_time'/);
  assert.doesNotMatch(feesPure, /DASHBOARD_FEES_VAT_RATE|=\s*0\.18/);
  assert.match(feesPure, /COUNTRY_PACK_STANDARD_VAT_KEY/);
  assert.match(officeProvider, /resolveCountryContext/);
  assert.match(officeProvider, /historical_unavailable/);
  assert.match(officeCopy, /לפני מע״מ/);
  assert.match(officeProvider, /coming_soon/);
  assert.match(dashSrc, /collected_cash_note_he/);
  assert.doesNotMatch(dashSrc, /monthly_revenue\.amount\s*\+|sumInvoices|total_revenue\s*=/);
});

test('Dashboard office queries stay org-scoped and do not use current prices as historical truth', () => {
  assert.match(officeProvider, /\.eq\(orgCol, orgId\)/);
  assert.match(officeProvider, /feeScheduleBasisForPeriod/);
  assert.match(officeProvider, /canReconstructMonthlyExpectedFromFeeHistory/);
  assert.doesNotMatch(officeProvider, /fallback_il/);
});

test('Missing-fee clients deep-link to the fees workspace tab', () => {
  assert.match(officeProvider, /tab=fees/);
  assert.match(caseSrc, /searchParams\.get\('tab'\)/);
  assert.match(officeCopy, /לא הוגדר שכ״ט/);
});

test('Nested Dashboard V2 tiles use the same translucent glass as production cards', () => {
  assert.match(dashCss, /linear-gradient\(180deg, rgba\(248, 252, 255, 0\.2\)/);
  assert.match(dashCss, /rgba\(210, 238, 255, 0\.5\)/);
  assert.doesNotMatch(dashCss, /background: rgba\(8, 38, 82, 0\.28\)/);
  assert.match(dashCss, /\.nx-dashboard-list__row[\s\S]*rgba\(248, 252, 255/);
  assert.match(dashCss, /\.nx-dashboard-attention__item[\s\S]*rgba\(248, 252, 255/);
});
