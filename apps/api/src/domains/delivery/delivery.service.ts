import { badRequest, notFound } from '../../shared/errors.js';
import type { DeliveryAttemptRepository } from './delivery.repository.js';
import {
  validateBeginDeliveryAttemptInput,
  validateFinalizeDeliveryAttemptInput,
} from './delivery.pure.js';
import type {
  BeginDeliveryAttemptInput,
  DeliveryAttemptRecord,
  FinalizeDeliveryAttemptInput,
  ListDeliveryAttemptsFilter,
} from './delivery.types.js';

export type DeliveryService = {
  beginAttempt(input: BeginDeliveryAttemptInput): Promise<DeliveryAttemptRecord>;
  finalizeAttempt(input: FinalizeDeliveryAttemptInput): Promise<DeliveryAttemptRecord>;
  listAttempts(filter: ListDeliveryAttemptsFilter): Promise<DeliveryAttemptRecord[]>;
};

export function createDeliveryService(repository: DeliveryAttemptRepository): DeliveryService {
  return {
    async beginAttempt(input: BeginDeliveryAttemptInput): Promise<DeliveryAttemptRecord> {
      validateBeginDeliveryAttemptInput(input);
      return repository.insertAttempt(input);
    },

    async finalizeAttempt(input: FinalizeDeliveryAttemptInput): Promise<DeliveryAttemptRecord> {
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

    async listAttempts(filter: ListDeliveryAttemptsFilter): Promise<DeliveryAttemptRecord[]> {
      if (!String(filter.organizationId ?? '').trim()) {
        throw badRequest('organization_id is required');
      }
      return repository.listAttempts(filter);
    },
  };
}
