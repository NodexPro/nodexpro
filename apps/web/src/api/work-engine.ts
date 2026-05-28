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
  queue_bucket?: string | null;
  limit?: number | null;
  offset?: number | null;
};

export type QueuePresentationGroup =
  | 'row_primary'
  | 'row_secondary'
  | 'row_overflow'
  | 'admin_overflow';

export type QueueAllowedActionCommand =
  | 'assign'
  | 'transfer'
  | 'mark_waiting_client'
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
  presentation_group: QueuePresentationGroup;
};

export type QueueOpenDetailAction = {
  kind: 'open_queue_item_detail';
  label: string;
  enabled: boolean;
  reason: string | null;
  presentation_group: 'row_primary';
};

export type QueueWorkEngineCommandInteraction = 'immediate' | 'modal';

export type QueueEscalationCommandKind =
  | 'escalate_work_item'
  | 'acknowledge_escalation'
  | 'resolve_escalation'
  | 'reassign_escalation_owner';

export type QueueOverflowMenuItem = {
  channel: 'ownership' | 'review' | 'semantic' | 'work_engine_command';
  command: string;
  label: string;
  enabled: boolean;
  reason: string | null;
  command_payload?: Record<string, unknown> | null;
  interaction?: QueueWorkEngineCommandInteraction;
  modal_form_key?: QueueEscalationCommandKind;
};

export type WorkEngineEscalationFormSelectField = {
  key: string;
  kind: 'select';
  label: string;
  required: boolean;
  options: QueueLabeledOption[];
};

export type WorkEngineEscalationFormTextareaField = {
  key: string;
  kind: 'textarea';
  label: string;
  required: boolean;
  placeholder?: string | null;
};

export type WorkEngineEscalationFormField =
  | WorkEngineEscalationFormSelectField
  | WorkEngineEscalationFormTextareaField;

export type WorkEngineEscalationCommandForm = {
  command: QueueEscalationCommandKind;
  title: string;
  submit_label: string;
  cancel_label: string;
  fields: WorkEngineEscalationFormField[];
};

export type WorkEngineEscalationWorkspace = {
  command_forms: Partial<Record<QueueEscalationCommandKind, WorkEngineEscalationCommandForm>>;
};

export type QueueOverflowMenuSection = {
  section_title: string | null;
  items: QueueOverflowMenuItem[];
};

export type QueueOverflowAdminBlock = {
  panel_title: string;
  submenu_trigger_label: string;
  items: QueueOverflowMenuItem[];
};

export type QueueOverflowMenuModel = {
  trigger_label: string;
  sections: QueueOverflowMenuSection[];
  admin: QueueOverflowAdminBlock | null;
};

export type QueueShellSecondaryAction = {
  channel: 'ownership' | 'review';
  command: string;
  label: string;
  enabled: boolean;
  reason: string | null;
};

export type QueueRowQueueShell = {
  open_detail: QueueOpenDetailAction;
  secondary_actions: QueueShellSecondaryAction[];
  overflow_menu: QueueOverflowMenuModel;
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
  width_percent?: number;
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

export type QueueOwnershipCommand = {
  command: 'pick_up_unassigned' | 'claim_work_item' | 'release_claim';
  label: string;
  enabled: boolean;
  reason: string | null;
  presentation_group: QueuePresentationGroup;
};

export type QueueReviewCommand = {
  command: 'request_review' | 'approve_work_item' | 'reject_work_item';
  label: string;
  enabled: boolean;
  reason: string | null;
  presentation_group: QueuePresentationGroup;
};

export type QueueEscalationCommand = {
  command: QueueEscalationCommandKind;
  label: string;
  enabled: boolean;
  reason: string | null;
  presentation_group: QueuePresentationGroup;
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
  claimed_by_user_id?: string | null;
  claimed_at?: string | null;
  claimed_by_user_name?: string | null;
  ownership_commands?: QueueOwnershipCommand[];
  review_flow_status_label?: string | null;
  review_commands?: QueueReviewCommand[];
  escalation_commands?: QueueEscalationCommand[];
  escalation_owner_id?: string | null;
  escalation_owner_name?: string | null;
  escalation_reason?: string | null;
  escalation_source?: string | null;
  escalation_source_label?: string | null;
  escalation_prior_work_state?: string | null;
  escalation_acknowledged_at?: string | null;
  escalation_acknowledged_label?: string | null;
  due_at: string | null;
  sla_status: string;
  sla_status_label: string;
  sla_badges?: Array<{ kind: string; label: string; tone: 'neutral' | 'warn' | 'danger' }>;
  primary_due_at_label?: string | null;
  override_active: boolean;
  override_summary: string | null;
  allowed_actions: QueueAllowedAction[];
  allowed_transitions: QueueRowAllowedTransition[];
  allowed_override_kinds: QueueRowAllowedOverrideKind[];
  version: number;
  updated_at: string;
  /** Backend-computed visible cell values for the queue table (keyed by queue_table column keys). */
  queue_cells: Record<string, string | null>;
  /** Optional native title/tooltip text per column key (presentation only). */
  queue_cell_titles?: Record<string, string | null>;
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

export type ReminderReviewAllowedAction = {
  action_key: string;
  label: string;
  enabled: boolean;
  disabled_reason: string | null;
  command: string;
  command_payload: Record<string, unknown>;
};

export type ReminderReviewDetailField = {
  key: string;
  label: string;
  value: string | null;
};

export type ReminderReviewDetailMessage = {
  subject_label: string;
  subject: string | null;
  show_subject: boolean;
  body_label: string;
  body: string;
};

export type ReminderReviewDetailModel = {
  title: string;
  subtitle: string | null;
  summary_fields: ReminderReviewDetailField[];
  message: ReminderReviewDetailMessage;
  channel_labels: string[];
};

export type ReminderReviewOpenDetailAction = {
  label: string;
  enabled: boolean;
  disabled_reason: string | null;
};

export type ReminderReviewQueueRow = {
  reminder_candidate_id: string;
  queue_cells: {
    client: string | null;
    workflow: string;
    period: string | null;
    channel: string;
    status: string;
  };
  open_detail: ReminderReviewOpenDetailAction;
  reminder_detail_model: ReminderReviewDetailModel;
  allowed_actions: ReminderReviewAllowedAction[];
};

export type ReminderReviewBanner = {
  visible: boolean;
  variant: 'warning' | 'brand';
  title: string;
  subtitle: string;
  cta_label: string;
  cta_action: { action_key: 'open_reminder_review' };
  dismissible: boolean;
};

export type WorkspaceTabBadgeVariant = 'neutral' | 'warning' | 'urgent' | null;

export type AccountantWorkspaceTab = {
  key: string;
  label: string;
  subtitle: string;
  icon_key: string;
  route: string;
  active: boolean;
  badge_count: number | null;
  badge_variant: WorkspaceTabBadgeVariant;
  enabled: boolean;
  disabled_reason: string | null;
  aggregate_route: string | null;
  hidden: boolean;
};

export type WorkEngineQueueAggregate = {
  aggregate_key: 'work_engine_queue_aggregate';
  org_id: string;
  generated_at: string;
  queue_view_mode?: 'work_items';
  workspace_tabs?: AccountantWorkspaceTab[];
  reminder_review_summary?: {
    pending_count: number;
    urgent_count: number;
    overdue_count: number;
  };
  banner?: ReminderReviewBanner;
  snooze_presets?: Array<{ preset_key: string; label: string }>;
  escalation_workspace?: WorkEngineEscalationWorkspace;
  summary_cards: {
    total_active: number;
    assigned_to_me: number;
    unassigned: number;
    claimed_by_me: number;
    review_for_me: number;
    waiting_client: number;
    waiting_human: number;
    review_pending: number;
    overdue: number;
    escalated: number;
    pending_mapping: number;
    pending_reminders?: number;
  };
  filters: {
    states: QueueStateOption[];
    modules: QueueLabeledOption[];
    assignees: QueueLabeledOption[];
    reviewers: QueueLabeledOption[];
    period_keys: QueueLabeledOption[];
    queue_buckets: QueueLabeledOption[];
    pending_mapping_reasons: QueueLabeledOption[];
  };
  applied_filters: {
    state: string | null;
    module_key: string | null;
    assigned_user_id: string | null;
    reviewer_user_id: string | null;
    client_id: string | null;
    period_key: string | null;
    queue_bucket: string | null;
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
  reminder_review_table?: WorkEngineQueueTableModel;
  reminder_review_rows?: ReminderReviewQueueRow[];
  reminder_review_pagination?: {
    limit: number;
    offset: number;
    total_matching: number;
    returned: number;
  };
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
  if (f.queue_bucket) qs.set('queue_bucket', f.queue_bucket);
  if (typeof f.limit === 'number' && Number.isFinite(f.limit)) qs.set('limit', String(f.limit));
  if (typeof f.offset === 'number' && Number.isFinite(f.offset)) qs.set('offset', String(f.offset));
}

export type WorkEngineInvoicesTabColumnType = 'text' | 'money_reference' | 'date' | 'status';

export type WorkEngineInvoicesTabColumn = {
  key: string;
  label: string;
  type: WorkEngineInvoicesTabColumnType;
};

export type WorkEngineOfficeClientIssuerOption = {
  issuer_business_id: string;
  represented_client_id: string;
  label: string;
  display_name: string;
  legal_name: string | null;
  tax_id: string | null;
  business_type: string | null;
  business_type_label: string | null;
  address_json: Record<string, unknown> | null;
  phone: string | null;
  email: string | null;
  vat_registration_status: string | null;
  country_code: string;
  enabled: boolean;
  disabled_reason: string | null;
};

export type WorkEngineInvoicesDocumentCreationEntrypoint = {
  button_label: string;
  allowed: boolean;
  allowed_action: string;
  disabled_reason: string | null;
  wizard: {
    steps: { key: string; label: string; when?: string }[];
    issuer_choice: {
      title: string;
      options: {
        key: string;
        label: string;
        acting_mode: 'self' | 'office_representative';
        issuer_business_id: string | null;
        enabled: boolean;
        disabled_reason: string | null;
      }[];
    };
    office_client_issuer_options: WorkEngineOfficeClientIssuerOption[];
    office_client_display_labels: {
      tax_id_label: string;
      phone_label: string;
      email_label: string;
      address_label: string;
    };
    recipient_search: {
      label: string;
      placeholder: string;
      create_fields_schema: Array<{
        key: string;
        label: string;
        required: boolean;
        input_type: 'text' | 'checkbox';
        placeholder: string | null;
      }>;
      save_for_future_label: string;
    };
    document_details_step: {
      document_date_label: string;
      document_date_required: boolean;
      notes_label: string;
    };
    income_commands: Record<string, string> & {
      resume_draft: string;
      save_draft: string;
    };
  };
};

export type WorkEngineInvoicesTabAggregate = {
  aggregate_key: 'work_engine_invoices_tab_aggregate';
  org_id: string;
  workspace_tabs: AccountantWorkspaceTab[];
  title: string;
  description: string;
  table_model: {
    columns: WorkEngineInvoicesTabColumn[];
    rows: Array<Record<string, string | number | null>>;
    empty_state: { visible: boolean; title: string; description: string | null };
  };
  summary: {
    rows_count: number;
    sum_paid_reference: number;
    avg_paid_reference: number;
    currency: string;
  };
  filters: [];
  allowed_actions: string[];
  document_creation_entrypoint: WorkEngineInvoicesDocumentCreationEntrypoint;
  draft_entrypoints: Array<{
    draft_id: string;
    title: string;
    subtitle: string | null;
    status_label: string;
    last_saved_at: string;
    total_display: string | null;
    line_count: number;
    allowed_actions: Array<{
      command: 'resume_income_document_draft';
      label: string;
      enabled: boolean;
      reason: string | null;
      command_payload: { draft_id: string };
    }>;
  }>;
  gaps: string[];
};

export async function fetchWorkEngineInvoicesTabAggregate(): Promise<WorkEngineInvoicesTabAggregate> {
  return apiJson<WorkEngineInvoicesTabAggregate>(WORK_ENGINE.aggregateInvoicesTab);
}

export type WorkEngineClientsTabAggregate = {
  aggregate_key: 'work_engine_clients_tab_aggregate';
  org_id: string;
  workspace_tabs: AccountantWorkspaceTab[];
  title: string;
  description: string;
  source_module: 'client_operations';
  embedded_view: 'client_operations_first_screen';
  client_operations_aggregate: {
    rows: Array<{
      client_id: string;
      client_name: string | null;
      tax_id: string | null;
      business_type: string | null;
      payroll_flag: boolean | null;
      material_brought_flag: boolean | null;
      vat_status: string | null;
      income_tax_advance_status: string | null;
      national_insurance_status: string | null;
      national_insurance_deductions_status: string | null;
      income_tax_deductions_status: string | null;
      assigned_handler_user_id: string | null;
      notes_cell_text_he: string | null;
      operational_notes_count: number;
      vat_due_registry_display_he: string | null;
    }>;
    note_types: Array<{
      code: string;
      label_he: string;
      sort_order: number;
      allows_reminder: boolean;
    }>;
  };
  allowed_actions: string[];
};

export async function fetchWorkEngineClientsTabAggregate(): Promise<WorkEngineClientsTabAggregate> {
  return apiJson<WorkEngineClientsTabAggregate>(WORK_ENGINE.aggregateClientsTab);
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
