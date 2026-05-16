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
