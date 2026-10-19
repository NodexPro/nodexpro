/**
 * Dashboard V2.5 drill-downs: glass list modals, fee-attention reuse,
 * Work Engine task lists, upcoming reports, hidden Quick actions.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const dashSrc = readFileSync(join(dir, '../src/pages/Dashboard.tsx'), 'utf8');
const dashCss = readFileSync(join(dir, '../src/styles/nx-dashboard.css'), 'utf8');
const modalSrc = readFileSync(join(dir, '../src/components/dashboard/DashboardDrilldownModal.tsx'), 'utf8');
const feeModalSrc = readFileSync(join(dir, '../src/components/dashboard/DashboardFeeBreakdownModal.tsx'), 'utf8');
const endpoints = readFileSync(join(dir, '../src/api/endpoints.ts'), 'utf8');
const routesSrc = readFileSync(join(dir, '../../api/src/domains/dashboard/dashboard.routes.ts'), 'utf8');
const providerSrc = readFileSync(
  join(dir, '../../api/src/domains/dashboard/providers/dashboard-office.provider.ts'),
  'utf8',
);
const listsSrc = readFileSync(join(dir, '../../api/src/domains/dashboard/dashboard-office-lists.service.ts'), 'utf8');
const reportingSrc = readFileSync(
  join(dir, '../../api/src/domains/dashboard/dashboard-office-reporting.pure.ts'),
  'utf8',
);
const copySrc = readFileSync(join(dir, '../../api/src/domains/dashboard/dashboard-office-copy.pure.ts'), 'utf8');
const caseSrc = readFileSync(join(dir, '../src/pages/ClientOperationsClientCase.tsx'), 'utf8');

test('client KPIs and status segments open a Dashboard-owned glass list modal instead of navigating away', () => {
  assert.match(dashSrc, /action_key === 'open_client_list'/);
  assert.match(dashSrc, /dashboardOfficeClients\(\)/);
  assert.match(dashSrc, /DashboardDrilldownModal/);
  assert.match(dashSrc, /openClientList/);
  assert.doesNotMatch(dashSrc, /navigate\(kpi\.href\)/);
  assert.match(modalSrc, /createPortal\(/);
  assert.match(modalSrc, /document\.body/);
  assert.match(modalSrc, /Escape/);
  assert.doesNotMatch(modalSrc, /nx-modal/);
  assert.match(endpoints, /dashboard\/office-clients/);
  assert.match(routesSrc, /\/office-clients/);
  assert.match(routesSrc, /requireOfficeAdministration/);
  assert.match(providerSrc, /list_key: 'active'/);
  assert.match(providerSrc, /list_key: 'new_in_period'/);
  assert.match(providerSrc, /list_key: 'departed'/);
  assert.match(providerSrc, /list_key: 'status:active'/);
});

test('fee attention preview and View all reuse the existing breakdown modal with fee_attention', () => {
  assert.match(dashSrc, /openFeeAttention/);
  assert.match(dashSrc, /view_all_filter \?\? 'fee_attention'/);
  assert.match(dashSrc, /DashboardFeeBreakdownModal/);
  assert.match(providerSrc, /view_all_filter:[\s\S]*fee_attention/);
  assert.match(providerSrc, /tab=fees/);
  assert.match(caseSrc, /searchParams\.get\('tab'\)/);
  assert.doesNotMatch(dashSrc, /navigate\(c\.href\)/);
  assert.match(feeModalSrc, /dashboardOfficeFeeBreakdown\(\)/);
});

test('task counters open Dashboard task lists from Work Engine states and do not stitch the queue aggregate', () => {
  assert.match(dashSrc, /action_key === 'open_task_list'/);
  assert.match(dashSrc, /dashboardOfficeTasks\(\)/);
  assert.match(dashSrc, /openTaskList/);
  assert.doesNotMatch(dashSrc, /navigate\(item\.href/);
  assert.doesNotMatch(dashSrc, /fetchWorkEngineQueueAggregate/);
  assert.match(providerSrc, /list_key: weStatus === 'ready' \? 'overdue' : null/);
  assert.match(providerSrc, /list_key: weStatus === 'ready' \? 'due_today'/);
  assert.match(providerSrc, /list_key: weStatus === 'ready' \? 'review_pending'/);
  assert.match(providerSrc, /key: 'missing_documents'/);
  assert.match(providerSrc, /status: 'unavailable'/);
  assert.match(listsSrc, /work_state', 'overdue'/);
  assert.match(listsSrc, /work_item_id=/);
  assert.doesNotMatch(listsSrc, /\.limit\(500\)/);
  assert.match(listsSrc, /\.range\(from, from \+ PAGE - 1\)/);
  assert.match(endpoints, /dashboard\/office-tasks/);
});

test('upcoming reports render backend groups and open authorized applicable-client lists', () => {
  assert.match(dashSrc, /nx-dashboard-deadlines-table/);
  assert.match(dashSrc, /open_reporting_clients/);
  assert.match(dashSrc, /dashboardOfficeReportingClients\(\)/);
  assert.match(copySrc, /מועד אחרון/);
  assert.match(copySrc, /סוג דיווח/);
  assert.match(copySrc, /Due date/);
  assert.match(copySrc, /Report type/);
  assert.match(listsSrc, /country_reporting_calendar_entries/);
  assert.match(listsSrc, /status', 'active'/);
  assert.match(listsSrc, /isActiveUpcomingReportingEntry/);
  assert.match(copySrc, /Due-date timing/);
  assert.match(copySrc, /תזמון מועד/);
  assert.match(reportingSrc, /clientAppliesToReportingEntry/);
  assert.match(reportingSrc, /groupUpcomingReportingObligations/);
  assert.match(reportingSrc, /isActiveUpcomingReportingEntry/);
  assert.doesNotMatch(reportingSrc, /annual_report|דוח שנתי|15th|hardcode/);
  assert.doesNotMatch(dashSrc, /מע\"מ רגיל|31\/5|hardcodedDue/);
  assert.match(endpoints, /dashboard\/office-reporting-clients/);
});

test('donut is smaller without clipping and Quick actions stay hidden without deleting backend capabilities', () => {
  assert.match(dashSrc, /const size = 100/);
  assert.match(dashSrc, /const r = 42/);
  assert.match(dashSrc, /fullCircle: frac >= 1 \|\| angle >= 359\.9/);
  assert.doesNotMatch(dashSrc, /const size = 132/);
  assert.match(dashCss, /\.nx-dashboard-donut \{[\s\S]*width: 100px/);
  assert.match(dashCss, /\.nx-dashboard-donut \{[\s\S]*overflow: visible/);
  assert.match(dashCss, /\.nx-dashboard-legend \{[\s\S]*grid-template-columns: 1fr 1fr/);
  assert.doesNotMatch(dashSrc, /office\.quick_actions\.actions/);
  assert.match(providerSrc, /quick_actions:/);
  assert.match(copySrc, /פעולות מהירות/);
  assert.match(dashSrc, /office\.recent_activity/);
  assert.match(dashSrc, /office\.kpis\.clients_left/);
});

test('drill-down modal is bilingual, paginated on the server, and remounts to avoid duplicate fetches', () => {
  assert.match(modalSrc, /dir=\{dir\}/);
  assert.match(modalSrc, /page_size/);
  assert.match(modalSrc, /AbortController/);
  assert.match(modalSrc, /if \(!ac\.signal\.aborted\) setLoading\(false\)/);
  assert.match(feeModalSrc, /if \(!ac\.signal\.aborted\) setLoading\(false\)/);
  assert.match(dashSrc, /\{drilldownUrl \? \(/);
  assert.match(dashSrc, /key=\{drilldownUrl\}/);
  assert.match(copySrc, /Open client card/);
  assert.match(copySrc, /פתיחת כרטיס לקוח/);
  assert.match(copySrc, /Open task/);
  assert.match(copySrc, /פתיחת משימה/);
  assert.doesNotMatch(modalSrc, /slice\(0,\s*pageSize\)/);
});
