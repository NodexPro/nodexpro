import { badRequest, forbidden } from '../../shared/errors.js';
export function assertOrgInContext(ctx, organizationId) {
    if (!organizationId?.trim()) {
        throw badRequest('organization_id is required');
    }
    if (!ctx.organizationId || ctx.organizationId !== organizationId) {
        throw forbidden('Organization context required');
    }
}
export function assertPositiveAmount(amount) {
    if (!Number.isFinite(amount) || amount < 0) {
        throw badRequest('amount must be >= 0');
    }
}
