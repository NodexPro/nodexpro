/**
 * Work Engine queue — failed operational items summary (read-model only).
 */
export const FAILED_OPERATIONS_SOURCE_KEYS = [
    'delivery_attempts_failed',
    'income_pdf_render_failed',
    'work_event_intake_failed',
    'retainer_generation_failed',
    'accounting_posting_failed',
];
const SOURCE_LABELS = {
    delivery_attempts_failed: 'Delivery failed',
    income_pdf_render_failed: 'PDF render failed',
    work_event_intake_failed: 'Event intake failed',
    retainer_generation_failed: 'Retainer generation failed',
    accounting_posting_failed: 'Accounting posting failed',
};
const MODULE_LABELS = {
    income: 'Income',
    work_engine: 'Work Engine',
    'work-engine': 'Work Engine',
    'client-operations': 'Client Operations',
    docflow: 'DocFlow',
    delivery: 'Delivery',
};
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const FAILED_OPERATIONS_NOT_INCLUDED_NOTES = [
    'Payment match failures: not included yet — no persisted org-scoped failure status found.',
];
export function failedOperationsSourceLabel(sourceKey) {
    return SOURCE_LABELS[sourceKey];
}
export function resolveModuleLabel(moduleKey) {
    const key = (moduleKey ?? '').trim();
    if (!key)
        return '—';
    return MODULE_LABELS[key] ?? key;
}
export function formatFailedOperationOccurredLabel(iso) {
    if (!iso)
        return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return '—';
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = SHORT_MONTHS[date.getUTCMonth()] ?? '';
    const year = date.getUTCFullYear();
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    return `${day} ${month} ${year} ${hours}:${minutes}`;
}
export function resolveClientLabel(clientId, clientNameById) {
    if (!clientId)
        return '—';
    return clientNameById.get(clientId) ?? '—';
}
export function buildDeliveryHowToFix(channel, failureReason) {
    const reason = (failureReason ?? '').trim().toLowerCase();
    if (reason.includes('recipient') || reason.includes('email')) {
        return 'Check recipient email and sender configuration, then retry send.';
    }
    if ((channel ?? '').trim() === 'docflow') {
        return 'Open the DocFlow thread and retry send.';
    }
    if ((channel ?? '').trim() === 'email') {
        return 'Check recipient email and sender configuration, then retry send.';
    }
    return 'Review the delivery failure reason and retry.';
}
export function buildDefaultFailedOperationActions() {
    return [
        {
            action_key: 'open_source',
            label: 'Open',
            enabled: false,
            reason: 'Source navigation is not available yet.',
            kind: 'disabled',
        },
    ];
}
export function buildDeliveryFailedRow(params) {
    const reference = params.failure_reason?.trim() ||
        `${params.source_entity_type} ${String(params.source_entity_id).slice(0, 8)}`;
    return {
        id: `delivery:${params.id}`,
        client_id: params.client_id,
        client_label: params.client_label,
        module_key: params.source_module,
        module_label: resolveModuleLabel(params.source_module),
        source_key: 'delivery_attempts_failed',
        source_label: SOURCE_LABELS.delivery_attempts_failed,
        error_key: 'delivery_failed',
        error_label: params.failure_reason?.trim() || 'Delivery failed',
        how_to_fix: buildDeliveryHowToFix(params.channel, params.failure_reason),
        occurred_at: params.occurred_at,
        occurred_at_label: formatFailedOperationOccurredLabel(params.occurred_at),
        severity: 'critical',
        severity_label: 'Critical',
        status: 'failed',
        status_label: 'Failed',
        reference_label: reference,
        available_actions: buildDefaultFailedOperationActions(),
    };
}
export function buildIncomePdfFailedRow(params) {
    const reference = params.document_number
        ? `${params.document_type} #${params.document_number}`
        : params.document_type;
    return {
        id: `income_pdf:${params.id}`,
        client_id: params.client_id,
        client_label: params.client_label,
        module_key: 'income',
        module_label: resolveModuleLabel('income'),
        source_key: 'income_pdf_render_failed',
        source_label: SOURCE_LABELS.income_pdf_render_failed,
        error_key: 'pdf_render_failed',
        error_label: 'PDF render failed',
        how_to_fix: 'Open the document and retry PDF render.',
        occurred_at: params.occurred_at,
        occurred_at_label: formatFailedOperationOccurredLabel(params.occurred_at),
        severity: 'critical',
        severity_label: 'Critical',
        status: 'failed',
        status_label: 'Failed',
        reference_label: reference,
        available_actions: buildDefaultFailedOperationActions(),
    };
}
export function buildWorkEventFailedRow(params) {
    return {
        id: `work_event:${params.id}`,
        client_id: params.client_id,
        client_label: params.client_label,
        module_key: params.source_module,
        module_label: resolveModuleLabel(params.source_module),
        source_key: 'work_event_intake_failed',
        source_label: SOURCE_LABELS.work_event_intake_failed,
        error_key: 'event_intake_failed',
        error_label: params.processing_error?.trim() || 'Event intake failed',
        how_to_fix: 'Review event payload and source module.',
        occurred_at: params.occurred_at,
        occurred_at_label: formatFailedOperationOccurredLabel(params.occurred_at),
        severity: 'critical',
        severity_label: 'Critical',
        status: 'failed',
        status_label: 'Failed',
        reference_label: params.processing_error?.trim() || params.event_type,
        available_actions: buildDefaultFailedOperationActions(),
    };
}
export function buildRetainerGenerationFailedRow(params) {
    return {
        id: `retainer:${params.id}`,
        client_id: params.client_id,
        client_label: params.client_label,
        module_key: 'income',
        module_label: resolveModuleLabel('income'),
        source_key: 'retainer_generation_failed',
        source_label: SOURCE_LABELS.retainer_generation_failed,
        error_key: 'retainer_generation_failed',
        error_label: params.failure_reason?.trim() || 'Retainer generation failed',
        how_to_fix: 'Review the retainer schedule and retry generation.',
        occurred_at: params.occurred_at,
        occurred_at_label: formatFailedOperationOccurredLabel(params.occurred_at),
        severity: 'critical',
        severity_label: 'Critical',
        status: 'failed',
        status_label: 'Failed',
        reference_label: `Cycle #${params.cycle_number}`,
        available_actions: buildDefaultFailedOperationActions(),
    };
}
export function buildAccountingPostingFailedRow(params) {
    const reference = params.document_number
        ? `${params.document_type} #${params.document_number}`
        : params.document_type;
    return {
        id: `accounting_posting:${params.id}`,
        client_id: params.client_id,
        client_label: params.client_label,
        module_key: 'income',
        module_label: resolveModuleLabel('income'),
        source_key: 'accounting_posting_failed',
        source_label: SOURCE_LABELS.accounting_posting_failed,
        error_key: 'accounting_posting_failed',
        error_label: 'Accounting posting failed',
        how_to_fix: 'Open the document and retry accounting posting.',
        occurred_at: params.occurred_at,
        occurred_at_label: formatFailedOperationOccurredLabel(params.occurred_at),
        severity: 'critical',
        severity_label: 'Critical',
        status: 'failed',
        status_label: 'Failed',
        reference_label: reference,
        available_actions: buildDefaultFailedOperationActions(),
    };
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
export function mergeFailedOperationRows(rows, limit = 200) {
    return [...rows]
        .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
        .slice(0, limit);
}
export function resolveLastSeenAtFromRows(rows) {
    if (!rows.length)
        return null;
    return rows[0]?.occurred_at ?? null;
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
        {
            source_key: 'retainer_generation_failed',
            label: SOURCE_LABELS.retainer_generation_failed,
            count: params.retainerFailedCount,
        },
        {
            source_key: 'accounting_posting_failed',
            label: SOURCE_LABELS.accounting_posting_failed,
            count: params.accountingPostingFailedCount,
        },
    ];
    const total_count = sources.reduce((sum, row) => sum + row.count, 0);
    const tone = resolveFailedOperationsCardTone(total_count);
    const mergedRows = mergeFailedOperationRows(params.rows);
    return {
        total_count,
        sources,
        last_seen_at: resolveLastSeenAtFromRows(mergedRows),
        severity_label: resolveFailedOperationsSeverityLabel(total_count),
        card: {
            key: 'errors',
            label: 'Errors',
            count: total_count,
            tone,
            description: 'Failed delivery, PDF render, event intake, retainer, and posting operations',
            clickable: total_count > 0,
            modal_key: 'failed_operations',
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
        rows: mergedRows,
        notes: params.notes ?? [...FAILED_OPERATIONS_NOT_INCLUDED_NOTES],
    };
}
