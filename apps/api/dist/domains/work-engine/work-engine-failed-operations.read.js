/**
 * Work Engine — failed operational items counts (org-scoped read only).
 */
import { supabaseAdmin } from '../../db/client.js';
import { buildFailedOperationsSummary, failedOperationsSourceLabel, } from './work-engine-failed-operations.pure.js';
const RECENT_PER_SOURCE = 5;
const RECENT_MERGED_LIMIT = 10;
async function countDeliveryFailures(orgId) {
    const { count, error } = await supabaseAdmin
        .from('delivery_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('result', 'failed');
    if (error)
        throw error;
    return count ?? 0;
}
async function countIncomePdfFailures(orgId) {
    const { count, error } = await supabaseAdmin
        .from('income_documents')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('pdf_render_status', 'failed');
    if (error)
        throw error;
    return count ?? 0;
}
async function countWorkEventIntakeFailures(orgId) {
    const { count, error } = await supabaseAdmin
        .from('work_events')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('processing_status', 'failed');
    if (error)
        throw error;
    return count ?? 0;
}
async function loadRecentDeliveryFailures(orgId) {
    const { data, error } = await supabaseAdmin
        .from('delivery_attempts')
        .select('id, source_module, source_entity_type, source_entity_id, failure_reason, updated_at, created_at')
        .eq('organization_id', orgId)
        .eq('result', 'failed')
        .order('updated_at', { ascending: false })
        .limit(RECENT_PER_SOURCE);
    if (error)
        throw error;
    return (data ?? []).map((row) => {
        const r = row;
        const reference = r.failure_reason?.trim() ||
            `${r.source_entity_type} ${String(r.source_entity_id).slice(0, 8)}`;
        return {
            id: r.id,
            source_key: 'delivery_attempts_failed',
            label: failedOperationsSourceLabel('delivery_attempts_failed'),
            occurred_at: r.updated_at || r.created_at,
            reference_label: reference,
            module_key: r.source_module,
        };
    });
}
async function loadRecentIncomePdfFailures(orgId) {
    const { data, error } = await supabaseAdmin
        .from('income_documents')
        .select('id, document_type, document_number, updated_at, created_at')
        .eq('organization_id', orgId)
        .eq('pdf_render_status', 'failed')
        .order('updated_at', { ascending: false })
        .limit(RECENT_PER_SOURCE);
    if (error)
        throw error;
    return (data ?? []).map((row) => {
        const r = row;
        const reference = r.document_number
            ? `${r.document_type} #${r.document_number}`
            : r.document_type;
        return {
            id: r.id,
            source_key: 'income_pdf_render_failed',
            label: failedOperationsSourceLabel('income_pdf_render_failed'),
            occurred_at: r.updated_at || r.created_at,
            reference_label: reference,
            module_key: 'income',
        };
    });
}
async function loadRecentWorkEventFailures(orgId) {
    const { data, error } = await supabaseAdmin
        .from('work_events')
        .select('id, source_module, event_type, received_at, processing_error')
        .eq('org_id', orgId)
        .eq('processing_status', 'failed')
        .order('received_at', { ascending: false })
        .limit(RECENT_PER_SOURCE);
    if (error)
        throw error;
    return (data ?? []).map((row) => {
        const r = row;
        return {
            id: r.id,
            source_key: 'work_event_intake_failed',
            label: failedOperationsSourceLabel('work_event_intake_failed'),
            occurred_at: r.received_at,
            reference_label: r.processing_error?.trim() || r.event_type,
            module_key: r.source_module,
        };
    });
}
function mergeRecentRows(rows) {
    return [...rows]
        .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
        .slice(0, RECENT_MERGED_LIMIT);
}
function resolveLastSeenAt(rows) {
    if (!rows.length)
        return null;
    return rows[0]?.occurred_at ?? null;
}
export async function loadFailedOperationsSummary(orgId) {
    const [deliveryFailedCount, incomePdfFailedCount, workEventFailedCount, recentDelivery, recentIncomePdf, recentWorkEvents,] = await Promise.all([
        countDeliveryFailures(orgId),
        countIncomePdfFailures(orgId),
        countWorkEventIntakeFailures(orgId),
        loadRecentDeliveryFailures(orgId),
        loadRecentIncomePdfFailures(orgId),
        loadRecentWorkEventFailures(orgId),
    ]);
    const recent_failed_operations = mergeRecentRows([
        ...recentDelivery,
        ...recentIncomePdf,
        ...recentWorkEvents,
    ]);
    return buildFailedOperationsSummary({
        deliveryFailedCount,
        incomePdfFailedCount,
        workEventFailedCount,
        lastSeenAt: resolveLastSeenAt(recent_failed_operations),
        recentFailedOperations: recent_failed_operations,
    });
}
