/**
 * Observability-only diagnostics for income document issue pipeline.
 * Does not change issue semantics or HTTP error masking.
 */
import { randomUUID } from 'node:crypto';
export const INCOME_ISSUE_LOG_PREFIX = '[income-issue]';
export const INCOME_ISSUE_FAILED_LOG_PREFIX = '[income-issue][failed]';
export const INCOME_ISSUE_SUCCESS_STAGE_ORDER = [
    'issue_command_received',
    'draft_loaded',
    'existing_issued_document_checked',
    'numbering_started',
    'numbering_completed',
    'issued_document_insert_started',
    'issued_document_insert_completed',
    'accounting_posting_started',
    'accounting_posting_completed',
    'draft_mark_issued_started',
    'draft_mark_issued_completed',
    'recurring_cycle_link_started',
    'recurring_cycle_link_completed',
    'refreshed_case_started',
    'refreshed_case_completed',
];
const SAFE_LOG_KEYS = new Set([
    'correlation_id',
    'org_id',
    'draft_id',
    'issued_document_id',
    'recurring_cycle_id',
    'stage',
    'failing_stage',
    'last_completed_stage',
    'duration_ms',
    'code',
    'message',
    'details',
    'hint',
    'name',
    'stack',
]);
function shouldAdvanceLastCompleted(stage) {
    if (stage === 'issue_command_failed' || stage === 'accounting_posting_failed')
        return false;
    if (stage.startsWith('issued_document_cleanup_'))
        return false;
    return (stage.endsWith('_completed') ||
        stage === 'draft_loaded' ||
        stage === 'existing_issued_document_checked' ||
        stage === 'issue_command_received');
}
function defaultEmit(level, prefix, payload) {
    if (level === 'error') {
        console.error(prefix, payload);
        return;
    }
    console.info(prefix, payload);
}
export function createIncomeIssueDiagnostic(params) {
    return {
        correlation_id: params.correlation_id ?? randomUUID(),
        org_id: params.org_id,
        draft_id: params.draft_id,
        issued_document_id: null,
        recurring_cycle_id: params.recurring_cycle_id ?? null,
        last_completed_stage: null,
        command_started_ms: Date.now(),
        stage_started_ms: {},
        failed_logged: false,
        emit: params.emit,
    };
}
export function extractIncomeIssueSafeError(error) {
    const out = {};
    if (error == null)
        return out;
    if (typeof error === 'object') {
        const e = error;
        if (typeof e.code === 'string' || typeof e.code === 'number') {
            out.code = String(e.code);
        }
        if (typeof e.message === 'string')
            out.message = e.message.slice(0, 2000);
        if (typeof e.details === 'string')
            out.details = e.details.slice(0, 2000);
        if (typeof e.hint === 'string')
            out.hint = e.hint.slice(0, 2000);
        if (typeof e.name === 'string')
            out.name = e.name;
        if (typeof e.stack === 'string')
            out.stack = e.stack.slice(0, 4000);
        return out;
    }
    if (typeof error === 'string') {
        out.message = error.slice(0, 2000);
    }
    return out;
}
/** Whitelist-only payload — drops any sensitive / unexpected keys. */
export function sanitizeIncomeIssueLogPayload(payload) {
    const out = {};
    for (const key of SAFE_LOG_KEYS) {
        if (payload[key] === undefined)
            continue;
        out[key] = payload[key];
    }
    return out;
}
function baseIds(diag) {
    return {
        correlation_id: diag.correlation_id,
        org_id: diag.org_id,
        draft_id: diag.draft_id,
        issued_document_id: diag.issued_document_id,
        recurring_cycle_id: diag.recurring_cycle_id,
        last_completed_stage: diag.last_completed_stage,
    };
}
export function logIncomeIssueStage(diag, stage, extra) {
    const started = diag.stage_started_ms[stage];
    const duration_ms = extra?.duration_ms ??
        (started != null ? Date.now() - started : Date.now() - diag.command_started_ms);
    if (stage.endsWith('_started') || stage === 'issue_command_received') {
        diag.stage_started_ms[stage] = Date.now();
    }
    if (shouldAdvanceLastCompleted(stage)) {
        diag.last_completed_stage = stage;
    }
    const payload = sanitizeIncomeIssueLogPayload({
        ...baseIds(diag),
        stage,
        duration_ms,
        ...(extra?.code != null ? { code: extra.code } : {}),
        ...(extra?.message != null ? { message: extra.message } : {}),
        ...(extra?.details != null ? { details: extra.details } : {}),
        ...(extra?.hint != null ? { hint: extra.hint } : {}),
        ...(extra?.name != null ? { name: extra.name } : {}),
        ...(extra?.stack != null ? { stack: extra.stack } : {}),
    });
    const emit = diag.emit ?? defaultEmit;
    emit('info', INCOME_ISSUE_LOG_PREFIX, payload);
}
/**
 * Log stage progress around an async step. On error: logs safe error fields,
 * emits [income-issue][failed], then rethrows the original error unchanged.
 */
export async function withIncomeIssueStage(diag, opts, fn) {
    const startedAt = Date.now();
    diag.stage_started_ms[opts.started] = startedAt;
    logIncomeIssueStage(diag, opts.started, { duration_ms: 0 });
    try {
        const result = await fn();
        logIncomeIssueStage(diag, opts.completed, { duration_ms: Date.now() - startedAt });
        return result;
    }
    catch (error) {
        logIncomeIssueFailed(diag, opts.failing_stage, error);
        throw error;
    }
}
export function logIncomeIssueFailed(diag, failing_stage, error) {
    if (diag.failed_logged)
        return;
    diag.failed_logged = true;
    const safe = extractIncomeIssueSafeError(error);
    logIncomeIssueStage(diag, 'issue_command_failed', {
        ...safe,
        duration_ms: Date.now() - diag.command_started_ms,
    });
    const payload = sanitizeIncomeIssueLogPayload({
        ...baseIds(diag),
        stage: 'issue_command_failed',
        failing_stage,
        last_completed_stage: diag.last_completed_stage,
        duration_ms: Date.now() - diag.command_started_ms,
        ...safe,
    });
    const emit = diag.emit ?? defaultEmit;
    emit('error', INCOME_ISSUE_FAILED_LOG_PREFIX, payload);
}
export function optionalRecurringCycleIdFromBody(body) {
    const raw = body.recurring_cycle_review;
    if (!raw || typeof raw !== 'object')
        return null;
    const cycle_id = String(raw.cycle_id ?? '').trim();
    return cycle_id || null;
}
