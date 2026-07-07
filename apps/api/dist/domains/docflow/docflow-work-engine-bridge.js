/**
 * Stage 5 — DocFlow → Work Engine bridge.
 *
 * Emits `docflow.thread_needs_attention` through `intakeWorkEvent` only (no direct
 * work_items / work_events writes). DocFlow tables remain the communication truth;
 * Work Engine owns projected workflow memory.
 *
 * STRICT:
 *   - Never throws into DocFlow command handlers (additive only).
 *   - No financial truth, no legal/country period semantics. `period_key` is a
 *     synthetic workflow bucket `docflow:thread:<thread_id>` (see dedup policy),
 *     not a reporting period.
 *   - `event_type` must stay allowlisted in `work-engine.event-mapping.service.ts`.
 */
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { intakeWorkEvent } from '../work-engine/work-engine.event-intake.service.js';
import { PLATFORM_EVENT_DOCFLOW_THREAD_NEEDS_ATTENTION, } from '../../shared/platform-event-catalog.js';
const SOURCE_MODULE = 'docflow';
const SOURCE_ENTITY_TYPE = 'client_message_thread';
const EVENT_TYPE = PLATFORM_EVENT_DOCFLOW_THREAD_NEEDS_ATTENTION;
const SCHEMA_VERSION = 1;
/** Synthetic period bucket per thread — satisfies work_items.period_key NOT NULL + regex. */
export function docflowThreadWorkPeriodKey(threadId) {
    return `docflow:thread:${threadId}`;
}
export function docflowThreadNeedsAttentionOrgId(caller) {
    return caller.kind === 'office_request' ? caller.ctx.organizationId : caller.orgId;
}
export async function fetchClientMessageThreadRowForWorkEmit(orgId, clientId, threadId) {
    const { data, error } = await supabaseAdmin
        .from('client_message_threads')
        .select('thread_status, thread_type, module_key')
        .eq('id', threadId)
        .eq('org_id', orgId)
        .eq('client_id', clientId)
        .neq('thread_status', 'archived')
        .maybeSingle();
    if (error)
        throw error;
    if (!data)
        return null;
    return {
        thread_status: String(data.thread_status ?? ''),
        thread_type: String(data.thread_type ?? ''),
        module_key: data.module_key != null
            ? String(data.module_key)
            : null,
    };
}
function buildDocflowThreadNeedsAttentionIntakePayload(signal) {
    const periodKey = docflowThreadWorkPeriodKey(signal.threadId);
    const orgId = docflowThreadNeedsAttentionOrgId(signal.intakeCaller);
    return {
        org_id: orgId,
        client_id: signal.clientId,
        source_module: SOURCE_MODULE,
        source_entity_type: SOURCE_ENTITY_TYPE,
        source_entity_id: signal.threadId,
        event_type: EVENT_TYPE,
        period_key: periodKey,
        occurred_at: new Date().toISOString(),
        schema_version: SCHEMA_VERSION,
        emitted_by_type: 'system',
        emitted_by_id: null,
        payload: {
            thread_id: signal.threadId,
            thread_status: signal.threadStatus,
            thread_type: signal.threadType,
            ...(signal.moduleKey ? { module_key: signal.moduleKey } : {}),
        },
    };
}
function bridgeAuditActorUserId(signal) {
    return signal.intakeCaller.kind === 'office_request' ? signal.intakeCaller.ctx.user.id : null;
}
async function auditDocflowBridgeIntakeFailure(signal, error) {
    const orgId = docflowThreadNeedsAttentionOrgId(signal.intakeCaller);
    try {
        await writeAudit({
            organizationId: orgId,
            actorUserId: bridgeAuditActorUserId(signal),
            moduleCode: 'docflow',
            entityType: 'docflow_thread',
            entityId: signal.threadId,
            action: AUDIT_ACTIONS.DOCFLOW_WORK_ENGINE_BRIDGE_INTAKE_FAILED,
            payload: {
                client_id: signal.clientId,
                event_type: EVENT_TYPE,
                error,
            },
        });
    }
    catch {
        // best-effort audit
    }
}
/**
 * Same intake envelope as `emitDocflowThreadNeedsAttention`, but returns intake outcome
 * (used by Stage 6 backfill for metrics). Does not log on failure — caller decides.
 */
export async function emitDocflowThreadNeedsAttentionWithIntakeResult(signal) {
    const body = buildDocflowThreadNeedsAttentionIntakePayload(signal);
    try {
        const intake = await intakeWorkEvent(signal.intakeCaller, body);
        return { ok: true, intake };
    }
    catch (err) {
        return {
            ok: false,
            error: err?.message ?? String(err),
        };
    }
}
/**
 * Fire-and-forget intake for a DocFlow thread that should surface on the Work Engine queue.
 * Idempotent at the Work Engine layer (stable dedup tuple + active work_item reuse).
 */
export async function emitDocflowThreadNeedsAttention(signal) {
    const r = await emitDocflowThreadNeedsAttentionWithIntakeResult(signal);
    if (r.ok)
        return;
    const orgId = docflowThreadNeedsAttentionOrgId(signal.intakeCaller);
    const line = JSON.stringify({
        level: 'error',
        component: 'docflow_work_engine_bridge',
        event: 'docflow.thread_needs_attention.intake_failed',
        org_id: orgId,
        client_id: signal.clientId,
        thread_id: signal.threadId,
        error: r.error,
    });
    // eslint-disable-next-line no-console
    console.warn(line);
    await auditDocflowBridgeIntakeFailure(signal, r.error);
}
