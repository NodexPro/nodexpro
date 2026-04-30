import type { RequestContext } from '../../shared/context.js';
import type { DashboardOverviewPartial } from './dashboard-overview.types.js';

export interface DashboardProvider {
  code: string;
  required?: boolean;
  getOverviewPart(ctx: RequestContext): Promise<DashboardOverviewPartial>;
  /**
   * Used when provider fails; must return a partial with provider-owned fields set to unavailable
   * (or coming_soon/empty depending on your semantics).
   */
  getUnavailablePart?(ctx: RequestContext, error: unknown): DashboardOverviewPartial;
  supports?(ctx: RequestContext): boolean | Promise<boolean>;
}

