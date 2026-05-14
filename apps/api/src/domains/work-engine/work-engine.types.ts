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
] as const;
export type WorkState = (typeof WORK_STATES)[number];

export const SLA_STATUSES = ['none', 'on_track', 'due_soon', 'overdue', 'breached'] as const;
export type SlaStatus = (typeof SLA_STATUSES)[number];

export const TRANSITION_KINDS = [
  'command',
  'automation',
  'override',
  'system_correction',
] as const;
export type TransitionKind = (typeof TRANSITION_KINDS)[number];

export const ACTOR_TYPES = ['user', 'system', 'rule'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const CREATION_SOURCE_TYPES = ['event', 'command', 'rule', 'migration'] as const;
export type CreationSourceType = (typeof CREATION_SOURCE_TYPES)[number];

export const EVENT_DIRECTIONS = ['inbound', 'outbound'] as const;
export type EventDirection = (typeof EVENT_DIRECTIONS)[number];

export const EVENT_PROCESSING_STATUSES = [
  'accepted',
  'ignored_duplicate',
  'ignored_policy',
  'failed',
] as const;
export type EventProcessingStatus = (typeof EVENT_PROCESSING_STATUSES)[number];

export type WorkEngineCommandType =
  | 'create_work_item'
  | 'assign_work_item'
  | 'change_work_state'
  | 'set_work_deadline'
  | 'append_work_event'
  | 'apply_work_override'
  | 'intake_work_event'
  /** Stage 10 Phase 1 — ownership spine */
  | 'pick_up_unassigned'
  | 'transfer_work_item'
  | 'claim_work_item'
  | 'release_claim';

export type WorkEngineCommandPayload = Record<string, unknown>;

export type AllowedAction = {
  command: string;
  enabled: boolean;
  reason: string | null;
};

export type WorkEngineRefreshedAggregateKey =
  | 'work_engine_foundation_aggregate'
  | 'work_engine_queue_aggregate';

export type WorkEngineCommandResponse = {
  ok: true;
  command: WorkEngineCommandType;
  refreshed: {
    aggregate_key: WorkEngineRefreshedAggregateKey;
    aggregate: Record<string, unknown>;
  };
  /** Command-specific metadata (e.g. intake outcome). Never holds workflow truth. */
  meta?: Record<string, unknown>;
};

/**
 * Outcome of `intake_work_event` (Stage 3A). Backend-decided; UI must not recompute.
 *   - `created`         : new work_item created from this event
 *   - `reused_existing` : active work_item already existed; event recorded against it
 *   - `duplicate_event` : same (org, source_module, source_entity_id, event_type, period_key)
 *                         already processed; no work created or modified
 *   - `pending_mapping` : event accepted and stored, but cannot be safely mapped to a
 *                         (module_key, work_type, period_key) tuple, so NO work_item is
 *                         created. Backend never invents work_type — emitter must supply it.
 */
export type IntakeWorkEventOutcome =
  | 'created'
  | 'reused_existing'
  | 'duplicate_event'
  | 'pending_mapping';

export type IntakeWorkEventMeta = {
  intake_result: IntakeWorkEventOutcome;
  work_event_id: string;
  work_item_id: string | null;
  event_id: string;
  dedup_key: string;
  /** Present only when `intake_result === 'pending_mapping'`; backend-decided reason. */
  pending_reason?: string;
};

/** Inbound cross-module event envelope; see docs/work-engine-event-contract.md. */
export type WorkEventEnvelope = {
  event_id: string;
  org_id: string;
  client_id: string | null;
  source_module: string;
  source_entity_type: string;
  source_entity_id: string;
  event_type: string;
  period_key: string | null;
  occurred_at: string;
  emitted_by_type: ActorType;
  emitted_by_id: string | null;
  schema_version: number;
  payload: Record<string, unknown>;
  idempotency_key: string;
};

export type WorkEventIntakeResult = {
  result: 'accepted' | 'duplicate' | 'rejected';
  work_event_id: string | null;
  processing_status: EventProcessingStatus;
  processing_outcome: string;
  processing_error: string | null;
};

export type WorkItemRow = {
  id: string;
  org_id: string;
  client_id: string;
  module_key: string;
  work_type: string;
  period_key: string;
  work_state: WorkState;
  owner_user_id: string | null;
  assigned_user_id: string | null;
  reviewer_user_id: string | null;
  escalation_owner_id: string | null;
  due_at: string | null;
  sla_status: SlaStatus;
  source_module: string;
  source_entity_type: string;
  source_entity_id: string;
  created_by_rule_id: string | null;
  created_by_event_id: string | null;
  created_by_user_id: string | null;
  creation_source_type: CreationSourceType;
  version: number;
  override_active: boolean;
  override_summary_json: Record<string, unknown> | null;
  claimed_by_user_id: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Override kinds drive `apply_work_override` semantics; see docs/work-engine-override-precedence.md §2. */
export const OVERRIDE_KINDS = [
  'deadline',
  'assignment',
  'state',
  'escalation_cancel',
  'reminder_cancel',
  'reopen',
  'archive_non_done',
] as const;
export type OverrideKind = (typeof OVERRIDE_KINDS)[number];

/**
 * Override kinds that require `reason_text` per Section 3 of override doc.
 * `reopen` is included because resurrecting a terminal `done` work item must
 * leave an explicit audit reason — see docs/work-engine-state-machine.md §5.
 */
export const OVERRIDE_KINDS_REQUIRING_REASON: ReadonlySet<OverrideKind> = new Set([
  'deadline',
  'escalation_cancel',
  'reminder_cancel',
  'reopen',
]);

// ============================================================================
// Stage 3B — explicit event mapping layer.
// ============================================================================

/**
 * Resolved event mapping returned by `resolveEventMapping` when the inbound
 * `event_type` is present in the backend allowlist AND all required envelope
 * fields are present. Backend never invents these; the mapper picks them
 * verbatim from the static allowlist in `work-engine.event-mapping.service.ts`.
 */
export type EventMappingResolved = {
  resolved: true;
  /** Workflow domain (e.g. 'payroll'); becomes work_items.module_key. */
  module_key: string;
  /** Canonical work_type (e.g. 'payroll_document_collection'). */
  work_type: string;
  /** Initial work_state for the newly created work_item (one of WORK_STATES). */
  initial_state: WorkState;
};

/**
 * Mapping could not be resolved. Either the event_type is not in the allowlist
 * (`reason='unknown_event_mapping'`) or a required field is missing
 * (`reason='missing_period_key'`, etc.). The event must still be persisted as
 * `accepted_pending_mapping` so a future Stage 3C consumer or operator can
 * reprocess it once the contract is extended.
 */
export type EventMappingPending = {
  resolved: false;
  reason: string;
  missing_fields?: string[];
};

export type EventMappingResult = EventMappingResolved | EventMappingPending;
