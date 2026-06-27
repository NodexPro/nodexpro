/**
 * Work Engine queue — invoice / retainer attention card (read-model only).
 */
import { RECURRING_FAILURE_WORK_TYPE, RECURRING_WORK_TYPE, } from './work-engine-invoice-retainer.pure.js';
export const INVOICE_ATTENTION_QUEUE_BUCKET = 'invoice_attention';
export const INVOICE_ATTENTION_MODULE_KEY = 'income';
/** Existing income invoice/retainer workflow work_types only (no collection follow-up). */
export const INVOICE_ATTENTION_WORK_TYPES = [
    RECURRING_WORK_TYPE,
    RECURRING_FAILURE_WORK_TYPE,
];
export function isInvoiceAttentionWorkType(workType) {
    return INVOICE_ATTENTION_WORK_TYPES.includes(workType);
}
export function isInvoiceAttentionQueueBucket(bucket) {
    return bucket === INVOICE_ATTENTION_QUEUE_BUCKET;
}
export function resolveInvoiceAttentionCardTone(params) {
    if (params.totalCount <= 0)
        return 'neutral';
    if (params.failureCount > 0)
        return 'danger';
    return 'warning';
}
export function buildInvoiceAttentionCard(params) {
    return {
        key: 'invoice_attention',
        label: 'Recurring',
        count: params.totalCount,
        tone: resolveInvoiceAttentionCardTone(params),
        description: 'משימות פעילות במכונה להפקת חשבוניות, ריטיינרים ובדיקת טיוטות',
        clickable: true,
        filter: {
            queue_bucket: INVOICE_ATTENTION_QUEUE_BUCKET,
            module_key: INVOICE_ATTENTION_MODULE_KEY,
            state: null,
            assigned_user_id: null,
            reviewer_user_id: null,
            client_id: null,
            period_key: null,
        },
    };
}
