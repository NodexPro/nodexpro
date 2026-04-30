import type { RequestContext } from '../../../shared/context.js';
import type { DashboardOverviewPartial } from '../dashboard-overview.types.js';
import type { DashboardProvider } from '../dashboard-provider.js';

const CLIENT_OPERATIONS_PROVIDER_CODE = 'client-operations';

export const dashboardClientOperationsProvider: DashboardProvider = {
  code: CLIENT_OPERATIONS_PROVIDER_CODE,
  required: false,
  supports: () => true,
  async getOverviewPart(_ctx: RequestContext): Promise<DashboardOverviewPartial> {
    return {
      summary: {
        monthly_revenue_status: 'coming_soon',
        monthly_revenue: null,
      },
      charts: {
        filing_schedules: {
          monthly: null,
          every_2_months: null,
          mikdamot: null,
          status: 'coming_soon',
        },
      },
      operations: {
        clients_per_worker: null,
        clients_per_worker_status: 'coming_soon',
        report_deadlines: {
          as_of_date: null,
          overdue_total: null,
          monthly_overdue: null,
          bimonthly_overdue: null,
          mikdamot_overdue: null,
          status: 'coming_soon',
        },
      },
    };
  },
  getUnavailablePart(_ctx: RequestContext): DashboardOverviewPartial {
    return {
      summary: {
        monthly_revenue_status: 'unavailable',
        monthly_revenue: null,
      },
      charts: {
        filing_schedules: {
          monthly: null,
          every_2_months: null,
          mikdamot: null,
          status: 'unavailable',
        },
      },
      operations: {
        clients_per_worker: null,
        clients_per_worker_status: 'unavailable',
        report_deadlines: {
          as_of_date: null,
          overdue_total: null,
          monthly_overdue: null,
          bimonthly_overdue: null,
          mikdamot_overdue: null,
          status: 'unavailable',
        },
      },
    };
  },
};

