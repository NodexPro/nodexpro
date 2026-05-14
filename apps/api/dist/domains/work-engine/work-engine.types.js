/**
 * Work Engine types (Stage 2 foundation).
 * Source of truth: docs/work-engine-domain-model.md, docs/work-engine-state-machine.md,
 *                  docs/work-engine-event-contract.md, docs/work-engine-override-precedence.md.
 *
 * Architecture: Core -> Commands -> Aggregate -> UI. UI never recomputes any of these values.
 */
export const WORK_STATES = [
    'new',
    'assigned',
    'waiting_human',
    'waiting_client',
    'client_replied',
    'review_pending',
    'approved',
    'rejected',
    'overdue',
    'escalated',
    'done',
    'archived',
];
export const SLA_STATUSES = ['none', 'on_track', 'due_soon', 'overdue', 'breached'];
export const TRANSITION_KINDS = [
    'command',
    'automation',
    'override',
    'system_correction',
];
export const ACTOR_TYPES = ['user', 'system', 'rule'];
export const CREATION_SOURCE_TYPES = ['event', 'command', 'rule', 'migration'];
export const EVENT_DIRECTIONS = ['inbound', 'outbound'];
export const EVENT_PROCESSING_STATUSES = [
    'accepted',
    'ignored_duplicate',
    'ignored_policy',
    'failed',
];
/** Override kinds drive `apply_work_override` semantics; see docs/work-engine-override-precedence.md §2. */
export const OVERRIDE_KINDS = [
    'deadline',
    'assignment',
    'state',
    'escalation_cancel',
    'reminder_cancel',
    'reopen',
    'archive_non_done',
];
/**
 * Override kinds that require `reason_text` per Section 3 of override doc.
 * `reopen` is included because resurrecting a terminal `done` work item must
 * leave an explicit audit reason — see docs/work-engine-state-machine.md §5.
 */
export const OVERRIDE_KINDS_REQUIRING_REASON = new Set([
    'deadline',
    'escalation_cancel',
    'reminder_cancel',
    'reopen',
]);
