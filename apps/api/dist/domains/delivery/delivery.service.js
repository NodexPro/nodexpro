import { badRequest, notFound } from '../../shared/errors.js';
import { validateBeginDeliveryAttemptInput, validateFinalizeDeliveryAttemptInput, } from './delivery.pure.js';
export function createDeliveryService(repository) {
    return {
        async beginAttempt(input) {
            validateBeginDeliveryAttemptInput(input);
            return repository.insertAttempt(input);
        },
        async finalizeAttempt(input) {
            validateFinalizeDeliveryAttemptInput(input);
            const current = await repository.findById(input.organizationId, input.attemptId);
            if (!current) {
                throw notFound('Delivery attempt not found');
            }
            if (current.result !== 'pending') {
                return current;
            }
            return repository.finalizeAttempt(input);
        },
        async listAttempts(filter) {
            if (!String(filter.organizationId ?? '').trim()) {
                throw badRequest('organization_id is required');
            }
            return repository.listAttempts(filter);
        },
    };
}
