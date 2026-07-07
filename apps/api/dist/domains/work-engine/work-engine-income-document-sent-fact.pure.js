/**
 * INV-1 P9 — Income document sent facts consumed by Work Engine (pure helpers).
 */
import { INCOME_WORK_EVENT_DOCUMENT_SENT_BY_DOCFLOW, INCOME_WORK_EVENT_DOCUMENT_SENT_BY_EMAIL, } from '../income/income-work-engine-bridge.pure.js';
import { RECURRING_SEND_FOLLOWUP_WORK_TYPE } from './work-engine-invoice-retainer.pure.js';
export const INCOME_DOCUMENT_SENT_FACT_EVENT_TYPES = new Set([
    INCOME_WORK_EVENT_DOCUMENT_SENT_BY_EMAIL,
    INCOME_WORK_EVENT_DOCUMENT_SENT_BY_DOCFLOW,
]);
export function isIncomeDocumentSentFactEventType(eventType) {
    return INCOME_DOCUMENT_SENT_FACT_EVENT_TYPES.has(eventType);
}
export function matchesRecurringSendFollowupWorkItem(item, params) {
    return (item.module_key === 'income' &&
        item.work_type === RECURRING_SEND_FOLLOWUP_WORK_TYPE &&
        item.source_entity_id === params.recurringProfileId &&
        item.period_key === params.periodKey &&
        item.work_state !== 'done' &&
        item.work_state !== 'archived');
}
