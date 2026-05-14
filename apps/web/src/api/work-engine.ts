/**
 * Work Engine API types + thin transport helpers.
 *
 * Strict rules (Stage 4):
 *   - UI never invents labels, counters, allowed_actions, or states. Every
 *     visible value comes from the backend aggregate.
 *   - UI only sends commands; backend returns the FULL refreshed aggregate in
 *     the same response when `refresh_aggregate = work_engine_queue_aggregate`.
 *   - No stitched reads, no hidden GETs, no PATCH.
 *
 * Source of truth: apps/api/src/domains/work-engine/work-engine.read-models.service.ts
 *                  apps/api/src/domains/work-engine/work-engine.commands.service.ts
 */

import { apiJson } from './client';
import { WORK_ENGINE } from './endpoints';

export type WorkEngineQueueFiltersInput = {
  state?: string | null;
  module_key?: string | null;
  assigned_user_id?: string | null;
  reviewer_user_id?: string | null;
  client_id?: string | null;
  period_key?: string | null;
  limit?: number | null;
  offset?: number | null;
};

export type QueueAllowedActionCommand =
  | 'assign'
  | 'change_state'
  | 'set_deadline'
  | 'apply_override'
  | 'archive';

export type QueueAllowedAction = {
  command: QueueAllowedActionCommand;
  /** Backend-owned caption for overflow menu / secondary UI. */
  label: string;
  enabled: boolean;
  reason: string | null;
};

export type QueueOpenDetailAction = {
  kind: 'open_queue_item_detail';
  label: string;
  enabled: boolean;
  reason: string | null;
};

export type QueueRowQueueShell = {
  open_detail: QueueOpenDetailAction;
  overflow_menu_button_label: string;
};

export type QueueDetailSection =
  | { kind: 'kv_block'; title: string; rows: Array<{ label: string; value: string | null }> }
  | { kind: 'static_paragraph'; title: string; body: string }
  | { kind: 'open_path'; label: string; path: string };

export type QueueRowDetailPanel = {
  title: string;
  subtitle: string | null;
  sections: QueueDetailSection[];
};

export type QueueTableColumnModel = {
  key: string;
  label: string;
  empty_display: 'dash' | 'blank';
  kind: 'data' | 'actions';
};

export type WorkEngineQueueTableModel = {
  columns: QueueTableColumnModel[];
};

export type QueueLabeledOption = {
  value: string;
  label: string;
};

export type QueueStateOption = QueueLabeledOption & { terminal: boolean };

/** Backend-owned per-row state catalog for the change_state modal (Stage 4 fix). */
export type QueueRowAllowedTransition = {
  value: string;
  label: string;
  terminal: boolean;
};

/** Backend-owned per-row override catalog for the apply_override modal (Stage 4 fix). */
export type QueueRowAllowedOverrideKind = {
  value: string;
  label: string;
  requires_reason: boolean;
  requires_to_state: boolean;
  allowed_to_states?: QueueRowAllowedTransition[];
};

export type WorkEngineQueueRow = {
  work_item_id: string;
  client_id: string | null;
  client_name: string | null;
  module_key: string;
  module_label: string;
  work_type: string;
  work_type_label: string;
  period_key: string;
  work_state: string;
  work_state_label: string;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  reviewer_user_id: string | null;
  reviewer_user_name: string | null;
  due_at: string | null;
  sla_status: string;
  sla_status_label: string;
  override_active: boolean;
  override_summary: string | null;
  allowed_actions: QueueAllowedAction[];
  allowed_transitions: QueueRowAllowedTransition[];
  allowed_override_kinds: QueueRowAllowedOverrideKind[];
  version: number;
  updated_at: string;
  /** Backend-computed visible cell values for the queue table (keyed by queue_table column keys). */
  queue_cells: Record<string, string | null>;
  queue_shell: QueueRowQueueShell;
  command_modal_subject_line: string;
  detail_panel: QueueRowDetailPanel;
};

export type WorkEnginePendingMappingRow = {
  id: string;
  event_id: string;
  event_type: string;
  source_module: string;
  source_module_label: string;
  source_entity_type: string;
  source_entity_id: string;
  client_id: string | null;
  client_name: string | null;
  period_key: string | null;
  pending_reason: string;
  pending_reason_label: string;
  received_at: string;
  occurred_at: string;
};

export type WorkEngineQueueAggregate = {
  aggregate_key: 'work_engine_queue_aggregate';
  org_id: string;
  generated_at: string;
  summary_cards: {
    total_active: number;
    waiting_client: number;
    waiting_human: number;
    review_pending: number;
    overdue: number;
    escalated: number;
    pending_mapping: number;
  };
  filters: {
    states: QueueStateOption[];
    modules: QueueLabeledOption[];
    assignees: QueueLabeledOption[];
    reviewers: QueueLabeledOption[];
    period_keys: QueueLabeledOption[];
    pending_mapping_reasons: QueueLabeledOption[];
  };
  applied_filters: {
    state: string | null;
    module_key: string | null;
    assigned_user_id: string | null;
    reviewer_user_id: string | null;
    client_id: string | null;
    period_key: string | null;
  };
  pagination: {
    limit: number;
    offset: number;
    total_matching: number;
    returned: number;
  };
  /** Table structure (column order, labels, kinds) — UI renders verbatim. */
  queue_table: WorkEngineQueueTableModel;
  rows: WorkEngineQueueRow[];
  pending_mapping_section: {
    pending_mapping_count: number;
    recent_pending_mappings: WorkEnginePendingMappingRow[];
    reason_catalog: QueueLabeledOption[];
  };
};

export type WorkEngineCommandResponse = {
  ok: true;
  command: string;
  refreshed: {
    aggregate_key: 'work_engine_queue_aggregate' | 'work_engine_foundation_aggregate';
    aggregate: WorkEngineQueueAggregate | Record<string, unknown>;
  };
  meta?: Record<string, unknown>;
};

function appendFilterParams(qs: URLSearchParams, f: WorkEngineQueueFiltersInput): void {
  if (f.state) qs.set('state', f.state);
  if (f.module_key) qs.set('module_key', f.module_key);
  if (f.assigned_user_id) qs.set('assigned_user_id', f.assigned_user_id);
  if (f.reviewer_user_id) qs.set('reviewer_user_id', f.reviewer_user_id);
  if (f.client_id) qs.set('client_id', f.client_id);
  if (f.period_key) qs.set('period_key', f.period_key);
  if (typeof f.limit === 'number' && Number.isFinite(f.limit)) qs.set('limit', String(f.limit));
  if (typeof f.offset === 'number' && Number.isFinite(f.offset)) qs.set('offset', String(f.offset));
}

export async function fetchWorkEngineQueueAggregate(
  filters: WorkEngineQueueFiltersInput,
): Promise<WorkEngineQueueAggregate> {
  const qs = new URLSearchParams();
  appendFilterParams(qs, filters);
  const path = qs.toString()
    ? `${WORK_ENGINE.aggregateQueue}?${qs.toString()}`
    : WORK_ENGINE.aggregateQueue;
  return apiJson<WorkEngineQueueAggregate>(path);
}

/**
 * Execute a Work Engine command and request the queue aggregate to be
 * returned as the refreshed truth. The UI MUST replace its local aggregate
 * with `response.refreshed.aggregate` and never mutate rows in place.
 */
export async function executeWorkEngineQueueCommand(args: {
  command: string;
  payload: Record<string, unknown>;
  filters: WorkEngineQueueFiltersInput;
}): Promise<WorkEngineCommandResponse> {
  const body = {
    command: args.command,
    payload: {
      ...args.payload,
      refresh_aggregate: 'work_engine_queue_aggregate',
      aggregate_filters: { ...args.filters },
    },
  };
  return apiJson<WorkEngineCommandResponse>(WORK_ENGINE.commands, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
