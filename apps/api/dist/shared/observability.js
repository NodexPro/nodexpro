/**
 * P11.5 — Shared observability helpers (correlation, command lifecycle, slow aggregates).
 * Reuses deploy_marker from income-issue-diagnostic. No business behavior.
 */
import { randomUUID } from 'node:crypto';
import { resolveApiDeployMarker } from '../domains/income/income-issue-diagnostic.js';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const CORRELATION_HEADER = 'x-correlation-id';
/** Critical Income commands — INFO start/end only (no flood). */
export const CRITICAL_INCOME_COMMANDS = new Set([
    'issue_income_document',
    'issue_and_send_income_document',
    'save_income_document_draft',
    'generate_income_document_preview',
    'send_income_document_by_email',
    'send_income_document_by_docflow',
    'record_income_document_payment',
]);
/** Critical Work Engine commands — INFO start/end only (no flood of every queue click). */
export const CRITICAL_WORK_ENGINE_COMMANDS = new Set([
    'create_income_recurring_document_profile',
    'update_income_recurring_document_profile',
    'pause_income_recurring_document_profile',
    'resume_income_recurring_document_profile',
    'cancel_income_recurring_document_profile',
    'approve_recurring_document_draft',
    'open_recurring_cycle_draft_for_review',
    'open_recurring_cycle_override_for_edit',
    'save_recurring_cycle_override',
    'create_work_item',
    'change_work_state',
    'approve_work_item',
    'escalate_work_item',
    'intake_work_event',
    'scheduler_run',
]);
const SAFE_COMMAND_LOG_KEYS = new Set([
    'correlation_id',
    'module',
    'command',
    'organization_id',
    'duration_ms',
    'result',
    'failing_stage',
    'safe_error',
    'deploy_marker',
    'entity_type',
    'entity_id',
    'draft_id',
    'income_document_id',
    'run_id',
    'aggregate_key',
    'payload_bytes',
]);
export function resolveCorrelationId(raw) {
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (UUID_RE.test(trimmed))
            return trimmed;
    }
    return randomUUID();
}
export function slowAggregateThresholdMs() {
    const n = Number(process.env.SLOW_AGGREGATE_THRESHOLD_MS ?? '3000');
    return Number.isFinite(n) && n > 0 ? n : 3000;
}
function sanitizeObsPayload(payload) {
    const out = {};
    for (const key of SAFE_COMMAND_LOG_KEYS) {
        if (payload[key] === undefined)
            continue;
        out[key] = payload[key];
    }
    return out;
}
export function extractSafeErrorMessage(error) {
    if (error instanceof Error)
        return error.message.slice(0, 500);
    if (typeof error === 'string')
        return error.slice(0, 500);
    return 'unknown_error';
}
export function logCommandReceived(params) {
    console.info('[command_received]', sanitizeObsPayload({
        correlation_id: params.correlation_id,
        module: params.module,
        command: params.command,
        organization_id: params.organization_id ?? null,
        entity_type: params.entity_type,
        entity_id: params.entity_id ?? null,
        draft_id: params.draft_id ?? null,
        deploy_marker: resolveApiDeployMarker(),
    }));
    return Date.now();
}
export function logCommandCompleted(params) {
    console.info('[command_completed]', sanitizeObsPayload({
        correlation_id: params.correlation_id,
        module: params.module,
        command: params.command,
        organization_id: params.organization_id ?? null,
        entity_type: params.entity_type,
        entity_id: params.entity_id ?? null,
        draft_id: params.draft_id ?? null,
        income_document_id: params.income_document_id ?? null,
        duration_ms: Date.now() - params.started_ms,
        result: 'success',
        deploy_marker: resolveApiDeployMarker(),
    }));
}
export function logCommandFailed(params) {
    console.error('[command_failed]', sanitizeObsPayload({
        correlation_id: params.correlation_id,
        module: params.module,
        command: params.command,
        organization_id: params.organization_id ?? null,
        entity_type: params.entity_type,
        entity_id: params.entity_id ?? null,
        draft_id: params.draft_id ?? null,
        duration_ms: Date.now() - params.started_ms,
        result: 'failure',
        failing_stage: params.failing_stage ?? null,
        safe_error: extractSafeErrorMessage(params.error),
        deploy_marker: resolveApiDeployMarker(),
    }));
}
export function emitSlowAggregateWarning(payload) {
    if (payload.duration_ms < slowAggregateThresholdMs())
        return;
    console.warn('[slow-aggregate]', {
        aggregate_key: payload.aggregate_key,
        correlation_id: payload.correlation_id ?? null,
        organization_id: payload.organization_id ?? null,
        duration_ms: payload.duration_ms,
        payload_bytes: payload.payload_bytes ?? null,
        stage_timings: payload.stage_timings ?? null,
        deploy_marker: resolveApiDeployMarker(),
    });
}
export function jsonByteLength(value) {
    try {
        return Buffer.byteLength(JSON.stringify(value), 'utf8');
    }
    catch {
        return 0;
    }
}
export async function withCriticalCommandObs(params, run, onSuccess) {
    if (!params.enabled)
        return run();
    const started_ms = logCommandReceived(params);
    try {
        const result = await run();
        const extra = onSuccess?.(result) ?? {};
        logCommandCompleted({ ...params, started_ms, ...extra });
        return result;
    }
    catch (error) {
        logCommandFailed({ ...params, started_ms, error });
        throw error;
    }
}
