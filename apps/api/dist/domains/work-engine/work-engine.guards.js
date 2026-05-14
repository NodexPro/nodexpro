/**
 * Work Engine guards and validators (Stage 2 foundation).
 * Source of truth: docs/work-engine-state-machine.md, docs/work-engine-dedup-policy.md,
 *                  docs/work-engine-override-precedence.md.
 */
import { supabaseAdmin } from '../../db/client.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import { WORK_STATES } from './work-engine.types.js';
/** period_key format per docs/work-engine-dedup-policy.md §8. */
export const PERIOD_KEY_REGEX = /^[a-z][a-z0-9_]*:[a-z0-9][a-z0-9_:-]*$/;
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export function isUuid(v) {
    return UUID_REGEX.test(v);
}
export function reqString(payload, key) {
    const v = String(payload[key] ?? '').trim();
    if (!v)
        throw badRequest(`${key} is required`);
    return v;
}
export function asOptionalString(v) {
    if (v === undefined || v === null)
        return null;
    const out = String(v).trim();
    return out ? out : null;
}
export function asOptionalIso(v) {
    if (v === undefined || v === null)
        return null;
    const s = String(v).trim();
    if (!s)
        return null;
    if (!Number.isFinite(new Date(s).getTime()))
        throw badRequest('Invalid ISO datetime');
    return s;
}
export function reqInt(payload, key) {
    const raw = payload[key];
    if (raw === undefined || raw === null)
        throw badRequest(`${key} is required`);
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        throw badRequest(`${key} must be a non-negative integer`);
    }
    return n;
}
export function assertOrgScope(ctx, organizationId) {
    if (!ctx.organizationId || ctx.organizationId !== organizationId) {
        throw forbidden('Organization context required');
    }
    if (!ctx.membership) {
        throw forbidden('Organization membership required');
    }
}
export async function assertClientBelongsToOrg(orgId, clientId) {
    if (!isUuid(clientId))
        throw badRequest('client_id must be a uuid');
    const { data, error } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('id', clientId)
        .eq('organization_id', orgId)
        .maybeSingle();
    if (error)
        throw error;
    if (!data)
        throw notFound('Client not found');
}
export function assertValidWorkState(value) {
    if (!WORK_STATES.includes(value)) {
        throw badRequest(`Invalid work_state: ${value}`);
    }
    return value;
}
export function assertValidPeriodKey(value) {
    if (!PERIOD_KEY_REGEX.test(value)) {
        throw badRequest(`period_key must match ${PERIOD_KEY_REGEX.source} (see docs/work-engine-dedup-policy.md §8)`);
    }
    return value;
}
/**
 * State machine transition matrix from docs/work-engine-state-machine.md §5.
 *
 * IMPORTANT: `done` is TERMINAL for normal transitions. The only path out of `done`
 * is the explicit `apply_work_override` command with `override_kind='reopen'`
 * (mandatory `reason_text` audit). The `change_work_state` command cannot move
 * a work item out of `done` — see `canTransitionWorkState` below.
 *
 * Only documents transitions reachable via direct command/override; automation-only
 * transitions (e.g. waiting_* -> overdue, *_> escalated) are handled by future rule
 * worker, not by the command-level `change_work_state` path.
 */
const ALLOWED_TRANSITIONS = {
    new: new Set(['assigned', 'waiting_client', 'waiting_human', 'archived']),
    assigned: new Set([
        'waiting_human',
        'waiting_client',
        'review_pending',
        'done',
        'archived',
    ]),
    waiting_human: new Set([
        'assigned',
        'waiting_client',
        'review_pending',
        'archived',
    ]),
    waiting_client: new Set([
        'assigned',
        'waiting_human',
        'client_replied',
        'archived',
    ]),
    client_replied: new Set([
        'waiting_human',
        'waiting_client',
        'review_pending',
        'archived',
    ]),
    review_pending: new Set(['approved', 'rejected', 'archived']),
    approved: new Set(['done', 'archived']),
    rejected: new Set([
        'assigned',
        'waiting_human',
        'waiting_client',
        'archived',
    ]),
    overdue: new Set([
        'assigned',
        'waiting_human',
        'waiting_client',
        'done',
        'archived',
    ]),
    escalated: new Set(['assigned', 'done', 'archived']),
    // `done` is terminal for change_work_state. Reopen requires the explicit
    // apply_work_override command with override_kind='reopen' and reason_text.
    done: new Set(['archived']),
    archived: new Set([]),
};
/**
 * States that a `reopen` override may move a `done` work item into. Anything else
 * is rejected. This is intentionally narrow — full lifecycle resume only.
 */
const REOPEN_TARGET_STATES = new Set([
    'assigned',
    'waiting_human',
    'waiting_client',
]);
export function canTransitionWorkState(from, to) {
    if (from === to)
        return false;
    return Boolean(ALLOWED_TRANSITIONS[from]?.has(to));
}
/**
 * Read-only projection of the state-machine matrix for aggregate render hints.
 *
 * The returned array is the set of `to` states that `change_work_state` will
 * accept from the given `from` state, in deterministic order. Mutating this
 * array does not affect the backend matrix.
 */
export function getAllowedTransitionsFrom(from) {
    return Array.from(ALLOWED_TRANSITIONS[from] ?? new Set());
}
/**
 * True iff `to` is a valid reopen target from a `done` work item.
 * Caller (apply_work_override) is responsible for enforcing override_kind='reopen'
 * and mandatory reason_text before invoking this.
 */
export function canReopenFromDone(to) {
    return REOPEN_TARGET_STATES.has(to);
}
/** Read-only projection of the reopen target set for aggregate render hints. */
export function getReopenTargetStates() {
    return Array.from(REOPEN_TARGET_STATES);
}
export function assertExpectedVersion(current, expected) {
    if (current !== expected) {
        throw conflict(`Version conflict: expected ${expected}, current ${current}`, 'WORK_ITEM_VERSION_CONFLICT');
    }
}
