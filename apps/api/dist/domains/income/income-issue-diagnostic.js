/**
 * Observability-only diagnostics for income document issue pipeline.
 * Does not change issue semantics or HTTP error masking.
 */
import { randomUUID } from 'node:crypto';
export const INCOME_ISSUE_LOG_PREFIX = '[income-issue]';
export const INCOME_ISSUE_FAILED_LOG_PREFIX = '[income-issue][failed]';
export const NODEXPRO_API_BOOT_LOG_PREFIX = '[nodexpro-api][boot]';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const INCOME_ISSUE_SUCCESS_STAGE_ORDER = [
    'issue_command_received',
    'draft_id_validation_started',
    'draft_id_validation_completed',
    'recurring_issuer_scope_resolve_started',
    'recurring_issuer_scope_resolve_completed',
    'issuer_scope_load_started',
    'issuer_scope_load_completed',
    'permission_check_started',
    'permission_check_completed',
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
    'deploy_marker',
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
    'NODE_ENV',
    'income_issue_diagnostics',
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
/** Safe UUID for logs — never echo arbitrary/unsafe request strings. */
export function safeUuidForLog(value) {
    if (typeof value !== 'string' && typeof value !== 'number')
        return null;
    const s = String(value).trim();
    return UUID_RE.test(s) ? s : null;
}
export function resolveApiDeployMarker() {
    const candidates = [
        process.env.RENDER_GIT_COMMIT,
        process.env.RENDER_GIT_COMMIT_SHA,
        process.env.SOURCE_VERSION,
        process.env.GIT_COMMIT,
        process.env.COMMIT_SHA,
        process.env.VERCEL_GIT_COMMIT_SHA,
    ];
    for (const raw of candidates) {
        const v = String(raw ?? '').trim();
        if (v)
            return v.slice(0, 64);
    }
    return 'unknown';
}
export function createIncomeIssueDiagnostic(params) {
    return {
        correlation_id: params.correlation_id ?? randomUUID(),
        org_id: params.org_id,
        draft_id: params.draft_id,
        issued_document_id: null,
        recurring_cycle_id: params.recurring_cycle_id ?? null,
        deploy_marker: params.deploy_marker ?? resolveApiDeployMarker(),
        last_completed_stage: null,
        failing_stage: null,
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
export function buildNodexproApiBootPayload(params) {
    return sanitizeIncomeIssueLogPayload({
        NODE_ENV: params?.NODE_ENV ?? process.env.NODE_ENV ?? 'undefined',
        deploy_marker: params?.deploy_marker ?? resolveApiDeployMarker(),
        income_issue_diagnostics: true,
    });
}
export function logNodexproApiBoot(emit) {
    const payload = buildNodexproApiBootPayload();
    const write = emit ?? defaultEmit;
    write('info', NODEXPRO_API_BOOT_LOG_PREFIX, payload);
}
function baseIds(diag) {
    return {
        correlation_id: diag.correlation_id,
        org_id: diag.org_id,
        draft_id: diag.draft_id,
        issued_document_id: diag.issued_document_id,
        recurring_cycle_id: diag.recurring_cycle_id,
        deploy_marker: diag.deploy_marker,
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
    diag.failing_stage = failing_stage;
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
    return safeUuidForLog(raw.cycle_id);
}
