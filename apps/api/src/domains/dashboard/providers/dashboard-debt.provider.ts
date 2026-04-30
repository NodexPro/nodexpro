import type { RequestContext } from '../../../shared/context.js';
import type { DashboardOverviewPartial } from '../dashboard-overview.types.js';
import type { DashboardProvider } from '../dashboard-provider.js';

const DEBT_PROVIDER_CODE = 'debt';

export const dashboardDebtProvider: DashboardProvider = {
  code: DEBT_PROVIDER_CODE,
  required: false,
  supports: () => true,
  async getOverviewPart(_ctx: RequestContext): Promise<DashboardOverviewPartial> {
    return {
      summary: {
        debtors_status: 'coming_soon',
        debtors_count: null,
        debtors_amount: null,
      },
    };
  },
  getUnavailablePart(_ctx: RequestContext): DashboardOverviewPartial {
    return {
      summary: {
        debtors_status: 'unavailable',
        debtors_count: null,
        debtors_amount: null,
      },
    };
  },
};

