export {
  createDeliveryService,
  type DeliveryService,
} from './delivery.service.js';
export { beginAttempt, deliveryService, finalizeAttempt, listAttempts } from './delivery.runtime.js';
export type { DeliveryAttemptRepository } from './delivery.repository.js';
export { SupabaseDeliveryAttemptRepository, defaultDeliveryAttemptRepository } from './delivery.repository.js';
export {
  DELIVERY_ATTEMPT_IMMUTABLE_FIELDS,
  isDeliveryChannel,
  mapDeliveryAttemptRow,
  validateBeginDeliveryAttemptInput,
  validateFinalizeDeliveryAttemptInput,
} from './delivery.pure.js';
export type {
  BeginDeliveryAttemptInput,
  DeliveryAttemptRecord,
  DeliveryAttemptResult,
  DeliveryAttachmentRef,
  DeliveryChannel,
  FinalizeDeliveryAttemptInput,
  ListDeliveryAttemptsFilter,
} from './delivery.types.js';
export { DELIVERY_ATTEMPT_RESULTS, DELIVERY_CHANNELS } from './delivery.types.js';
export { sendEmail, type DeliveryEmailTransportDeps } from './delivery-email.transport.js';
export {
  normalizeDeliveryEmailFailureReason,
  validateDeliveryEmailEnvelope,
} from './delivery-email.pure.js';
export type {
  DeliveryEmailAttachment,
  DeliveryEmailEnvelope,
  DeliveryEmailSendResult,
  DeliveryEmailSendStatus,
} from './delivery-email.types.js';
