import type { RequestContext } from '../../shared/context.js';
import type { DashboardOverview, DashboardOverviewPartial } from './dashboard-overview.types.js';
import type { DashboardProvider } from './dashboard-provider.js';
import type { DashboardStatus } from './dashboard-status.js';
import { getDashboardProviders, registerDashboardProvider } from './dashboard-provider-registry.js';
import { dashboardCoreProvider } from './providers/dashboard-core.provider.js';
import { dashboardClientOperationsProvider } from './providers/dashboard-client-operations.provider.js';
import { dashboardDebtProvider } from './providers/dashboard-debt.provider.js';

function assignIfDefined<T extends object>(target: T, patch: Partial<T>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (target as any)[k] = v;
  }
}

function mergeOverviewPartial(result: DashboardOverview, patch: DashboardOverviewPartial): DashboardOverview {
  if (patch.summary) {
    assignIfDefined(result.summary, patch.summary);
  }
  if (patch.charts) {
    if (patch.charts.new_clients_by_month) result.charts.new_clients_by_month = patch.charts.new_clients_by_month;
    if (patch.charts.filing_schedules) assignIfDefined(result.charts.filing_schedules, patch.charts.filing_schedules);
  }
  if (patch.operations) {
    if (patch.operations.clients_per_worker) result.operations.clients_per_worker = patch.operations.clients_per_worker;
    if (patch.operations.clients_per_worker_status) result.operations.clients_per_worker_status = patch.operations.clients_per_worker_status;
    if (patch.operations.report_deadlines) assignIfDefined(result.operations.report_deadlines, patch.operations.report_deadlines);
  }
  if (patch.organization) {
    assignIfDefined(result.organization, patch.organization);
  }
  if (patch.quick_actions) {
    assignIfDefined(result.quick_actions, patch.quick_actions);
  }
  return result;
}

function makeBaseOverview(): DashboardOverview {
  const unavailable: DashboardStatus = 'unavailable';
  const base: DashboardOverview = {
    summary: {
      new_clients_this_month: 0,
      new_clients_last_month: 0,
      new_clients_vs_last_month_pct: null,
      new_clients_vs_last_month_abs: 0,
      total_clients: 0,
      total_clients_secondary_line: null,

      debtors_status: unavailable,
      debtors_count: null,
      debtors_amount: null,

      monthly_revenue_status: unavailable,
      monthly_revenue: null,
    },
    charts: {
      new_clients_by_month: [],
      filing_schedules: {
        monthly: null,
        every_2_months: null,
        mikdamot: null,
        status: unavailable,
      },
    },
    operations: {
      clients_per_worker: null,
      clients_per_worker_status: unavailable,
      report_deadlines: {
        as_of_date: null,
        overdue_total: null,
        monthly_overdue: null,
        bimonthly_overdue: null,
        mikdamot_overdue: null,
        status: unavailable,
      },
    },
    organization: {
      name: '',
      trial_status: '',
      trial_ends_at: null,
      active_plan: '—',
    },
    quick_actions: {
      can_create_client: false,
      can_upload_document: false,
      can_invite_member: false,
    },
  };
  return base;
}

// Default dashboard providers (core + module slots).
// Note: registry overrides by code, so this is safe if imported multiple times.
registerDashboardProvider(dashboardCoreProvider);
registerDashboardProvider(dashboardClientOperationsProvider);
registerDashboardProvider(dashboardDebtProvider);

export async function getDashboardOverviewAggregated(ctx: RequestContext): Promise<DashboardOverview> {
  const providers: DashboardProvider[] = getDashboardProviders();
  const result = makeBaseOverview();

  for (const provider of providers) {
    const supported = provider.supports ? await provider.supports(ctx) : true;
    if (!supported) continue;

    try {
      const part = await provider.getOverviewPart(ctx);
      mergeOverviewPartial(result, part);
    } catch (e) {
      if (provider.required) {
        throw e;
      }
      if (provider.getUnavailablePart) {
        const fallback = provider.getUnavailablePart(ctx, e);
        mergeOverviewPartial(result, fallback);
      }
    }
  }

  return result;
}

