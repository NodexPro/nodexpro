/**
 * Platform delivery ledger — module-agnostic types.
 * Callers supply source identity and snapshots; Delivery never interprets business documents.
 */
export const DELIVERY_CHANNELS = ['email', 'docflow'];
export const DELIVERY_ATTEMPT_RESULTS = ['pending', 'sent', 'failed'];
