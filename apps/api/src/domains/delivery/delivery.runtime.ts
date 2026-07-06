import { defaultDeliveryAttemptRepository } from './delivery.repository.js';
import { createDeliveryService } from './delivery.service.js';
import type {
  BeginDeliveryAttemptInput,
  FinalizeDeliveryAttemptInput,
  ListDeliveryAttemptsFilter,
} from './delivery.types.js';

export const deliveryService = createDeliveryService(defaultDeliveryAttemptRepository);

export async function beginAttempt(input: BeginDeliveryAttemptInput) {
  return deliveryService.beginAttempt(input);
}

export async function finalizeAttempt(input: FinalizeDeliveryAttemptInput) {
  return deliveryService.finalizeAttempt(input);
}

export async function listAttempts(filter: ListDeliveryAttemptsFilter) {
  return deliveryService.listAttempts(filter);
}
