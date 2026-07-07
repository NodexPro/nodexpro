/**
 * Work Engine queue — failed operational items summary (read-model only).
 */
export const FAILED_OPERATIONS_SOURCE_KEYS = [
    'delivery_attempts_failed',
    'income_pdf_render_failed',
    'work_event_intake_failed',
];
const SOURCE_LABELS = {
    delivery_attempts_failed: 'Delivery failed',
    income_pdf_render_failed: 'PDF render failed',
    work_event_intake_failed: 'Event intake failed',
};
export function failedOperationsSourceLabel(sourceKey) {
    return SOURCE_LABELS[sourceKey];
}
export function resolveFailedOperationsCardTone(totalCount) {
    if (totalCount <= 0)
        return 'neutral';
    return 'danger';
}
export function resolveFailedOperationsSeverityLabel(totalCount) {
    if (totalCount <= 0)
        return 'No operational errors';
    return 'Operational errors require attention';
}
export function buildFailedOperationsSummary(params) {
    const sources = [
        {
            source_key: 'delivery_attempts_failed',
            label: SOURCE_LABELS.delivery_attempts_failed,
            count: params.deliveryFailedCount,
        },
        {
            source_key: 'income_pdf_render_failed',
            label: SOURCE_LABELS.income_pdf_render_failed,
            count: params.incomePdfFailedCount,
        },
        {
            source_key: 'work_event_intake_failed',
            label: SOURCE_LABELS.work_event_intake_failed,
            count: params.workEventFailedCount,
        },
    ];
    const total_count = sources.reduce((sum, row) => sum + row.count, 0);
    const tone = resolveFailedOperationsCardTone(total_count);
    return {
        total_count,
        sources,
        last_seen_at: params.lastSeenAt,
        severity_label: resolveFailedOperationsSeverityLabel(total_count),
        card: {
            key: 'errors',
            label: 'Errors',
            count: total_count,
            tone,
            description: 'Failed delivery, PDF render, and event intake operations',
            clickable: false,
            filter: {
                queue_bucket: '',
                module_key: null,
                state: null,
                assigned_user_id: null,
                reviewer_user_id: null,
                client_id: null,
                period_key: null,
            },
        },
        recent_failed_operations: params.recentFailedOperations ?? [],
    };
}
