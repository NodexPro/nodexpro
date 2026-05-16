/**
 * Pure escalation helpers (no DB — safe for unit tests).
 */
import { badRequest } from '../../shared/errors.js';
export const ESCALATION_SOURCES = [
    'manual_escalation',
    'sla_breached',
    'repeated_reminder_ignored',
    'delivery_failure_repeated',
    'blocked_review',
];
export const MANUAL_ESCALATABLE_WORK_STATES = new Set([
    'new',
    'assigned',
    'waiting_human',
    'waiting_client',
    'client_replied',
    'review_pending',
    'rejected',
    'overdue',
]);
export function parseEscalationSource(raw) {
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (!v || !ESCALATION_SOURCES.includes(v)) {
        throw badRequest(`escalation_source must be one of: ${ESCALATION_SOURCES.join(', ')}`, 'invalid_escalation_source');
    }
    return v;
}
export function parseEscalationReason(raw) {
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (!v) {
        throw badRequest('escalation_reason is required', 'escalation_reason_required');
    }
    if (v.length > 2000) {
        throw badRequest('escalation_reason is too long', 'escalation_reason_too_long');
    }
    return v;
}
export function buildEscalationSourceOptions() {
    return ESCALATION_SOURCES.map((value) => ({
        value,
        label: escalationSourceLabel(value),
    }));
}
export function escalationSourceLabel(source) {
    switch (source) {
        case 'manual_escalation':
            return 'Manual escalation';
        case 'sla_breached':
            return 'SLA breached';
        case 'repeated_reminder_ignored':
            return 'Repeated reminder ignored';
        case 'delivery_failure_repeated':
            return 'Delivery failure repeated';
        case 'blocked_review':
            return 'Blocked review';
        default:
            return source;
    }
}
export function isOrgManagerRole(roleCode) {
    return roleCode === 'owner' || roleCode === 'admin';
}
export function isEscalationOwner(row, userId) {
    return row.escalation_owner_id != null && row.escalation_owner_id === userId;
}
export function isEscalationAcknowledged(row) {
    return row.escalation_acknowledged_at != null && String(row.escalation_acknowledged_at).trim() !== '';
}
export function canManualEscalateWorkState(state) {
    return MANUAL_ESCALATABLE_WORK_STATES.has(state);
}
export function assertCanEscalateWorkItem(row) {
    if (row.work_state === 'escalated') {
        throw badRequest('Work item is already escalated', 'work_item_already_escalated');
    }
    if (row.work_state === 'done' || row.work_state === 'archived') {
        throw badRequest(`Cannot escalate work item in state '${row.work_state}'`, 'invalid_escalation_source_state');
    }
    if (!canManualEscalateWorkState(row.work_state)) {
        throw badRequest(`Cannot escalate from work_state='${row.work_state}'`, 'invalid_escalation_source_state');
    }
}
export function assertWorkItemIsEscalated(row) {
    if (row.work_state !== 'escalated') {
        throw badRequest(`Command requires work_state=escalated (current='${row.work_state}')`, 'work_item_not_escalated');
    }
}
export function assertHasEscalationPriorState(row) {
    const prior = row.escalation_prior_work_state;
    if (!prior) {
        throw badRequest('Escalation prior state is missing on work item', 'escalation_prior_state_missing');
    }
    return prior;
}
export function canEscalateWorkItem(ctx, row, hasOverridePermission) {
    if (!canManualEscalateWorkState(row.work_state))
        return false;
    if (row.work_state === 'escalated' || row.work_state === 'done' || row.work_state === 'archived') {
        return false;
    }
    return (isOrgManagerRole(ctx.roleCode) ||
        hasOverridePermission ||
        ctx.permissions.includes('work_engine.escalation.escalate'));
}
export function canAcknowledgeEscalation(ctx, row) {
    if (row.work_state !== 'escalated' || isEscalationAcknowledged(row))
        return false;
    return (isOrgManagerRole(ctx.roleCode) ||
        isEscalationOwner(row, ctx.userId) ||
        ctx.permissions.includes('work_engine.escalation.acknowledge'));
}
export function canResolveEscalation(ctx, row) {
    if (row.work_state !== 'escalated')
        return false;
    return (isOrgManagerRole(ctx.roleCode) ||
        isEscalationOwner(row, ctx.userId) ||
        ctx.permissions.includes('work_engine.escalation.resolve'));
}
export function canReassignEscalationOwner(ctx, row) {
    if (row.work_state !== 'escalated')
        return false;
    return isOrgManagerRole(ctx.roleCode) || ctx.permissions.includes('work_engine.escalation.reassign');
}
export const AUTO_ESCALATION_SOURCE = 'sla_breached';
export const AUTO_ESCALATION_REASON = 'SLA breached and requires manager attention.';
export function shouldAutoEscalateForSla(params) {
    if (params.work_state === 'escalated' || params.work_state === 'done' || params.work_state === 'archived') {
        return false;
    }
    if (params.sla_status === 'breached')
        return true;
    if (params.has_breached_obligation)
        return true;
    return false;
}
/** Backend-only owner pick order for system_rule escalation (MVP). */
export function resolveAutoEscalationOwnerId(workItem, members) {
    const byUser = new Map(members.map((m) => [m.user_id, m.role_code]));
    const tryId = (id) => {
        if (!id || !byUser.has(id))
            return null;
        return id;
    };
    const fromExisting = tryId(workItem.escalation_owner_id);
    if (fromExisting)
        return fromExisting;
    const fromReviewer = tryId(workItem.reviewer_user_id);
    if (fromReviewer)
        return fromReviewer;
    const assigneeId = workItem.assigned_user_id;
    if (assigneeId && byUser.has(assigneeId)) {
        const role = byUser.get(assigneeId);
        if (role === 'owner' || role === 'admin')
            return assigneeId;
    }
    const fromOwner = tryId(workItem.owner_user_id);
    if (fromOwner)
        return fromOwner;
    const manager = members.find((m) => m.role_code === 'owner' || m.role_code === 'admin');
    return manager?.user_id ?? null;
}
export function buildEscalationPriorStateTooltip(priorState) {
    if (!priorState)
        return null;
    return `Was ${workStateLabelForTooltip(priorState)}`;
}
function workStateLabelForTooltip(state) {
    switch (state) {
        case 'new':
            return 'New';
        case 'assigned':
            return 'Assigned';
        case 'waiting_human':
            return 'Waiting (Office)';
        case 'waiting_client':
            return 'Waiting Client';
        case 'client_replied':
            return 'Client Replied';
        case 'review_pending':
            return 'Review Pending';
        case 'approved':
            return 'Approved';
        case 'rejected':
            return 'Rejected';
        case 'overdue':
            return 'Overdue';
        case 'escalated':
            return 'Escalated';
        case 'done':
            return 'Done';
        case 'archived':
            return 'Archived';
        default:
            return state;
    }
}
