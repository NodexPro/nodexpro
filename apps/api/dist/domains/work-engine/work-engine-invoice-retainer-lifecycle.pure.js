/**
 * Retainer recurring document lifecycle — pure helpers.
 */
import { RECURRING_SEND_FOLLOWUP_DELAY_DAYS, RECURRING_WORK_TYPE } from './work-engine-invoice-retainer.pure.js';
export function matchesRecurringInvoiceReviewWorkItem(item, params) {
    return (item.module_key === 'income' &&
        item.work_type === RECURRING_WORK_TYPE &&
        item.source_entity_id === params.recurringProfileId &&
        item.period_key === params.periodKey &&
        item.work_state !== 'done' &&
        item.work_state !== 'archived');
}
export function isRecurringSendFollowupDue(params) {
    if (params.hasDeliveryRecord)
        return false;
    const approvedMs = new Date(params.approvedAtIso).getTime();
    const nowMs = new Date(params.nowIso).getTime();
    if (!Number.isFinite(approvedMs) || !Number.isFinite(nowMs))
        return false;
    const delayMs = RECURRING_SEND_FOLLOWUP_DELAY_DAYS * 24 * 60 * 60 * 1000;
    return nowMs >= approvedMs + delayMs;
}
