import type { RequestContext } from '../../shared/context.js';
import { badRequest, forbidden } from '../../shared/errors.js';

export function assertOrgInContext(ctx: RequestContext, organizationId: string): void {
  if (!organizationId?.trim()) {
    throw badRequest('organization_id is required');
  }
  if (!ctx.organizationId || ctx.organizationId !== organizationId) {
    throw forbidden('Organization context required');
  }
}

export function assertPositiveAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount < 0) {
    throw badRequest('amount must be >= 0');
  }
}
