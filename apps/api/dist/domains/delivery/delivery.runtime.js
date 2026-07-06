import { defaultDeliveryAttemptRepository } from './delivery.repository.js';
import { createDeliveryService } from './delivery.service.js';
export const deliveryService = createDeliveryService(defaultDeliveryAttemptRepository);
export async function beginAttempt(input) {
    return deliveryService.beginAttempt(input);
}
export async function finalizeAttempt(input) {
    return deliveryService.finalizeAttempt(input);
}
export async function listAttempts(filter) {
    return deliveryService.listAttempts(filter);
}
