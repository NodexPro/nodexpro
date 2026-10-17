import type { RequestContext } from '../../shared/context.js';
import type { DashboardOverviewPartial } from './dashboard-overview.types.js';
import type { DashboardOverviewQuery } from './dashboard-office.types.js';

export interface DashboardProvider {
  code: string;
  required?: boolean;
  getOverviewPart(ctx: RequestContext, query?: DashboardOverviewQuery): Promise<DashboardOverviewPartial>;
  /**
   * Used when provider fails; must return a partial with provider-owned fields set to unavailable
   * (or coming_soon/empty depending on your semantics).
   */
  getUnavailablePart?(ctx: RequestContext, error: unknown): DashboardOverviewPartial;
  supports?(ctx: RequestContext): boolean | Promise<boolean>;
}

