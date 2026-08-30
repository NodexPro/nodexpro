/**
 * Income workspace DTOs — mirror apps/api/src/domains/income/income.types.ts.
 * Transport-only; no business logic.
 */

export type IncomeActingMode = 'self' | 'office_representative';

export type IncomeDocumentType =
  | 'receipt'
  | 'tax_invoice'
  | 'tax_invoice_receipt'
  | 'credit_tax_invoice'
  | 'deal_invoice'
  | 'quote';

export type IncomeItemType = 'service' | 'product';

export interface IncomeWorkspaceWarning {
  code: string;
  message: string;
}

export interface IncomeAllowedActingMode {
  mode: IncomeActingMode;
  label: string;
  enabled: boolean;
  reason: string | null;
}

export interface IncomeIssuerOption {
  issuer_business_id: string;
  acting_mode: IncomeActingMode;
  label: string;
  represented_client_id: string | null;
}

export interface IncomeWorkspacePermissions {
  view: boolean;
  edit: boolean;
  issue: boolean;
  issue_on_behalf: boolean;
}

export type IncomeClientDocumentManagementActionIconKey =
  | 'settings'
  | 'end_customers'
  | 'reports'
  | 'ledger'
  | 'retainer'
  | 'at'
  | 'more'
  | 'plus';

export interface IncomeClientDocumentManagementRowAction {
  key: string;
  label: string;
  icon_key: IncomeClientDocumentManagementActionIconKey;
  command: string | null;
  command_payload: Record<string, unknown>;
  enabled: boolean;
  disabled_reason: string | null;
}


export type IncomeClientDocumentManagementPopulationKey =
  | 'office_client'
  | 'office_client_customer';

export interface IncomeClientDocumentManagementRowContext {
  population_key: IncomeClientDocumentManagementPopulationKey;
  acting_mode: 'office_representative';
  issuer_business_id: string;
  represented_client_id: string;
  income_customer_id: string | null;
}

export interface IncomeClientDocumentManagementRow {
  /** Backend population identity; optional for legacy aggregates. */
  population_key?: IncomeClientDocumentManagementPopulationKey;
  represented_client_id: string;
  /** End customer id when population_key = office_client_customer; otherwise null/omitted. */
  income_customer_id?: string | null;
  parent_represented_client_id?: string | null;
  parent_client_display_name?: string | null;
  client_display_name: string;
  client_logo_url: string | null;
  client_initials: string;
  tax_id: string | null;
  email: string | null;
  total_documents_count: number;
  quote_count: number;
  deal_count: number;
  tax_invoice_count: number;
  receipt_count: number;
  credit_count: number;
  document_type_counters?: IncomeClientDocumentTypeCounter[];
  unpaid_amount_reference: number | null;
  unpaid_amount_display: string;
  last_document_date: string | null;
  last_document_date_display: string;
  last_activity_at: string | null;
  last_activity_display: string;
  status_label: string;
  actions: IncomeClientDocumentManagementRowAction[];
  row_context?: IncomeClientDocumentManagementRowContext;
  /** Work Engine invoices tab: backend-owned Quick Card contract. */
  client_quick_card?: IncomeClientQuickCard | null;
}

export interface IncomeClientQuickCardRow {
  key: string;
  label: string;
  display_value: string;
  copy_value: string | null;
  copy_enabled: boolean;
}

export interface IncomeClientQuickCardAction {
  action_key: string;
  label: string;
  enabled: boolean;
  disabled_reason: string | null;
  state_key: string | null;
  command: string | null;
  command_payload: Record<string, unknown>;
}

export interface IncomeClientQuickCard {
  enabled: boolean;
  client_id: string;
  population_key: IncomeClientDocumentManagementPopulationKey;
  rows: IncomeClientQuickCardRow[];
  actions: IncomeClientQuickCardAction[];
}

export interface IncomeClientDocumentManagementCustomerGroup {
  parent_represented_client_id: string;
  parent_client_display_name: string;
  total_customers: number;
  rows: IncomeClientDocumentManagementRow[];
  /**
   * Issuer-level actions for this parent (document settings / customers / reports).
   * Backend-owned; not derived on the frontend from population or row position.
   */
  actions: IncomeClientDocumentManagementRowAction[];
}

export interface IncomeClientDocumentManagementSectionPage {
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface IncomeClientDocumentManagementSection {
  section_key: 'office_clients' | 'office_client_customers';
  title: string;
  total_count: number;
  rows: IncomeClientDocumentManagementRow[];
  groups: IncomeClientDocumentManagementCustomerGroup[] | null;
  page: IncomeClientDocumentManagementSectionPage;
  /**
   * Backend-owned population header actions (WE invoices office_clients).
   * Empty when absent. FE must not invent these.
   */
  header_actions: IncomeClientDocumentManagementRowAction[];
  empty_state: {
    visible: boolean;
    title: string;
    description: string | null;
  };
}

export type IncomeClientDocumentTypeCounterKey =
  | 'quote'
  | 'deal_invoice'
  | 'tax_invoice'
  | 'tax_invoice_receipt'
  | 'receipt'
  | 'credit_tax_invoice'
  | 'draft';

export interface IncomeClientDocumentTypeCounter {
  key: IncomeClientDocumentTypeCounterKey;
  label: string;
  count: number;
  tone: string;
  tooltip_label: string;
  action_key: 'open_documents_by_type';
  /** Backend-ready open context; FE must not invent parent/customer linkage. */
  action_params?: {
    represented_client_id: string;
    income_customer_id: string | null;
  };
}


export interface WorkEngineDocumentReopenAction {
  enabled: boolean;
  label: string;
  command: 'reopen_income_preliminary_document';
  reason_required: true;
  confirmation_title: string;
  confirmation_body: string;
  disabled_reason: string | null;
}

export interface WorkEngineDocumentCreditAction {
  visible: true;
  enabled: boolean;
  label: string;
  command: 'begin_income_tax_invoice_credit';
  disabled_reason: string | null;
  modes: Array<{ key: 'full' | 'partial'; label: string }>;
  reason_options: Array<{ key: string; label: string }>;
  reason_required: true;
}

export interface WorkEngineInvoicesClientDocumentsByTypeRow {
  row_id: string;
  document_number: string | null;
  document_type_label: string | null;
  issue_date_display: string | null;
  created_at_display: string | null;
  customer_display_name: string | null;
  amount_display: string;
  due_date_display: string | null;
  status_label: string;
  document_id: string | null;
  draft_id: string | null;
  can_view_document: boolean;
  can_edit_draft: boolean;
  pdf_download_path: string | null;
  allowed_actions: string[];
  email_delivery: IncomeDocumentEmailDeliveryBlock | null;
  docflow_delivery: IncomeDocumentDocflowDeliveryBlock | null;
  credit_action?: WorkEngineDocumentCreditAction | null;
  reopen_action?: WorkEngineDocumentReopenAction | null;
  lifecycle_state?: 'open' | 'closed' | null;
  lifecycle_label?: string | null;
  status_detail?: string | null;
  linked_document?: {
    document_id: string;
    document_number: string;
    document_type: string;
    document_type_label: string;
  } | null;
  row_visual_state?: 'muted' | null;
}

export interface WorkEngineInvoicesClientDocumentsByTypeAggregate {
  aggregate_key: 'work_engine_invoices_client_documents_by_type_aggregate';
  represented_client_id: string;
  client_display_name: string;
  document_type_key: IncomeClientDocumentTypeCounterKey;
  document_type_label: string;
  selected_year: number;
  available_years: number[];
  is_draft_mode: boolean;
  table_columns: Array<{ key: string; label: string }>;
  rows: WorkEngineInvoicesClientDocumentsByTypeRow[];
  allowed_actions: string[];
  empty_state: { visible: boolean; title: string; description: string | null };
}

export type RecurringDocumentFrequency =
  | 'days_45'
  | 'days_60'
  | 'days_90'
  | 'yearly'
  | 'semi_annual'
  | 'monthly'
  | 'biennial';
export type RecurringPriceIncreaseType = 'percent' | 'amount';
export type RecurringProfileStatus = 'active' | 'paused' | 'cancelled';
export type RecurringSchedulerStatus = 'scheduler_pending' | 'active' | 'failed';

export interface WorkEngineInvoiceRetainerEndCustomerRow {
  end_customer_id: string;
  display_name: string;
  email: string | null;
  tax_id: string | null;
  selectable: boolean;
  recurring_profile_id: string | null;
  profile_status: RecurringProfileStatus | null;
  profile_status_label: string | null;
  profile_summary: string | null;
}

export interface WorkEngineInvoiceRetainerSettings {
  profile_id: string | null;
  end_customer_id: string;
  end_customer_display_name: string;
  source_draft_template_id: string | null;
  document_template_snapshot: Record<string, unknown> | null;
  document_type: 'quote' | 'deal_invoice' | 'tax_invoice';
  document_type_label: string;
  document_type_change_note: string;
  frequency: RecurringDocumentFrequency;
  frequency_label: string;
  advance_days: number;
  advance_creation_help_text: string;
  draft_creation_date_label: string;
  draft_creation_date_display: string | null;
  service_period_start: string;
  service_period_start_display: string;
  service_period_end: string;
  service_period_end_display: string;
  auto_advance_period: boolean;
  price_increase_enabled: boolean;
  price_increase_type: RecurringPriceIncreaseType | null;
  price_increase_value: number | null;
  next_cycle_unit_price_before_vat_display: string | null;
  status: RecurringProfileStatus;
  status_label: string;
  status_description: string;
  next_document_date: string;
  next_document_date_display: string;
  last_generated_draft_id: string | null;
  last_generated_at: string | null;
  last_generated_at_display: string | null;
}

export interface WorkEngineInvoiceRetainerDocumentDraftWorkspace {
  income_workspace_aggregate: IncomeWorkspaceAggregate;
  income_commands: Record<string, string>;
}

export type WorkEngineInvoiceRetainerSetupTabKey = 'retainer' | 'next_document' | 'schedule';

export type WorkEngineInvoiceRetainerNextDocumentApplyScope = 'next_cycle_only' | 'all_future_cycles';

export type WorkEngineInvoiceRetainerChildDocumentHistoryRow = {
  cycle_id: string;
  cycle_number: number;
  scheduled_document_date_display: string;
  draft_creation_date_display: string;
  status: 'pending' | 'draft_created' | 'issued' | 'cancelled' | 'failed';
  status_label: string;
  generated_draft_id: string | null;
  generated_draft_reference_display: string | null;
  generated_document_id: string | null;
  generated_document_reference_display: string | null;
  failure_reason: string | null;
  allowed_actions: string[];
};

export interface WorkEngineInvoiceRetainerSetupTab {
  key: WorkEngineInvoiceRetainerSetupTabKey;
  label: string;
  enabled: boolean;
  disabled_reason: string | null;
}

export interface WorkEngineInvoiceRetainerNextDocumentPreviewInfoBlock {
  title: string;
  document_type_label: string | null;
  next_document_date_display: string | null;
  draft_review_date_label: string;
  draft_review_date_display: string | null;
  draft_review_advance_note: string | null;
  profile_status_label: string | null;
}

export interface WorkEngineInvoiceRetainerNextDocumentPreview {
  status: 'ready' | 'unavailable';
  unavailable_message: string | null;
  projection_id: string | null;
  next_document_date: string | null;
  next_document_date_display: string | null;
  price_increase_applied: boolean;
  price_increase_note: string | null;
  info_block: WorkEngineInvoiceRetainerNextDocumentPreviewInfoBlock;
  document_details_step: import('./income-document-details-types').IncomeDocumentDetailsStep | null;
  save_action: {
    visible: boolean;
    label: string;
    disabled_reason: string | null;
    apply_scope_dialog: {
      title: string;
      prompt: string;
      option_next_cycle_only: {
        key: 'next_cycle_only';
        label: string;
        description: string;
      };
      option_all_future_cycles: {
        key: 'all_future_cycles';
        label: string;
        description: string;
      };
      confirm_label: string;
      cancel_label: string;
      persistence_note: string;
    } | null;
  };
  allowed_actions: string[];
}

export type WorkEngineInvoiceRetainerScheduleProjectionAction = {
  key: string;
  label: string;
  disabled: boolean;
  disabled_reason: string | null;
  href: string | null;
  income_command: string | null;
  income_command_payload: Record<string, unknown> | null;
};

export type WorkEngineInvoiceRetainerScheduleOpenCycleDraftPrimaryAction = {
  command: 'open_recurring_cycle_draft_for_review';
  payload: {
    represented_client_id: string;
    profile_id: string;
    cycle_id: string;
    generated_draft_id: string;
    period_key: string;
    linked_work_item_id: string | null;
  };
};

export type WorkEngineInvoiceRetainerScheduleOpenNextDocumentTabPrimaryAction = {
  command: 'open_next_document_tab';
  payload: {
    target_tab: 'next_document';
    scheduled_document_date: string;
    period_key: string;
  };
};

export type WorkEngineInvoiceRetainerScheduleOpenCycleOverridePrimaryAction = {
  command: 'open_recurring_cycle_override_for_edit';
  payload: {
    represented_client_id: string;
    profile_id: string;
    cycle_date: string;
    period_key: string;
    cycle_index: number;
  };
};

export type WorkEngineInvoiceRetainerScheduleRowPrimaryAction =
  | WorkEngineInvoiceRetainerScheduleOpenCycleDraftPrimaryAction
  | WorkEngineInvoiceRetainerScheduleOpenNextDocumentTabPrimaryAction
  | WorkEngineInvoiceRetainerScheduleOpenCycleOverridePrimaryAction;

export type WorkEngineInvoiceRetainerScheduleRowPreviewAction = {
  visible: boolean;
  label: string;
  disabled_reason: string | null;
  command: 'preview_recurring_cycle_override';
  payload: {
    represented_client_id: string;
    profile_id: string;
    cycle_date: string;
    period_key: string;
    cycle_index: number;
  };
};

export type RecurringCycleOverrideScope = 'single_cycle' | 'this_and_future';

export type WorkEngineRecurringCycleOverrideApplyScopeDialog = {
  title: string;
  prompt: string;
  option_single_cycle: {
    key: 'single_cycle';
    label: string;
    description: string;
  };
  option_this_and_future: {
    key: 'this_and_future';
    label: string;
    description: string;
  };
  confirm_label: string;
  cancel_label: string;
  persistence_note: string | null;
};

export type WorkEngineRecurringCycleOverrideContextPanel = {
  office_client_label: string;
  end_customer_display_name: string;
  document_type_label: string;
  cycle_date_display: string;
  payment_terms_display: string | null;
  projection_note: string | null;
};

export type WorkEngineRecurringCycleOverrideSidebarField = {
  key: string;
  label: string;
  input_type: 'text' | 'date' | 'select' | 'textarea' | 'email';
  value: string | null;
  editable: boolean;
  disabled_reason: string | null;
  hint: string | null;
  options: Array<{ value: string; label: string }>;
  required: boolean;
  min_value: string | null;
  max_length: number | null;
};

export type WorkEngineRecurringCycleOverrideSidebarSection = {
  key: string;
  title: string;
  fields: WorkEngineRecurringCycleOverrideSidebarField[];
};

export type WorkEngineRecurringCycleOverrideRetainerSettingsSidebar = {
  retainer_settings: WorkEngineInvoiceRetainerSettings;
  document_type_options: Array<{
    key: 'quote' | 'deal_invoice' | 'tax_invoice';
    label: string;
    enabled: boolean;
    disabled_reason: string | null;
  }>;
  frequency_options: Array<{ key: RecurringDocumentFrequency; label: string }>;
  status_actions: {
    can_pause: boolean;
    can_resume: boolean;
    can_cancel: boolean;
    pause_label: string;
    resume_label: string;
    cancel_label: string;
  };
};

export type WorkEngineRecurringCycleOverrideAggregate = {
  aggregate_key: 'work_engine_recurring_cycle_override_aggregate';
  represented_client_id: string;
  profile_id: string;
  cycle_date: string;
  period_key: string;
  cycle_date_display: string;
  title: string;
  context_panel: WorkEngineRecurringCycleOverrideContextPanel;
  retainer_settings_sidebar: WorkEngineRecurringCycleOverrideRetainerSettingsSidebar;
  sidebar_sections: WorkEngineRecurringCycleOverrideSidebarSection[];
  override_exists: boolean;
  override_scope: RecurringCycleOverrideScope | null;
  document_details_step: import('./income-document-details-types').IncomeDocumentDetailsStep;
  preview_action: WorkEngineInvoiceRetainerScheduleRowPreviewAction;
  save_action: {
    visible: boolean;
    label: string;
    disabled_reason: string | null;
    apply_scope_dialog: WorkEngineRecurringCycleOverrideApplyScopeDialog | null;
  };
  delete_action: {
    visible: boolean;
    label: string;
    disabled_reason: string | null;
  };
  allowed_actions: string[];
};

export type WorkEngineRecurringCycleDraftReviewEditAction = {
  visible: boolean;
  enabled: boolean;
  label: string;
  disabled_reason: string | null;
};

export type WorkEngineRecurringCycleDraftReviewIssueMonthOption = {
  month_key: string;
  label: string;
  confirmation_message: string;
};

export type WorkEngineRecurringCycleDraftReviewIssueMonthSelector = {
  visible: boolean;
  current_month: string;
  default_month: string;
  selected_month: string;
  allowed_months: WorkEngineRecurringCycleDraftReviewIssueMonthOption[];
};

export type WorkEngineRecurringCycleDraftReviewIssueAction = {
  visible: boolean;
  enabled: boolean;
  disabled_reason: string | null;
  icon: 'issue';
  tooltip: string;
  confirmation_required: boolean;
  confirmation_title: string | null;
  confirmation_message: string | null;
  issue_month_selector: WorkEngineRecurringCycleDraftReviewIssueMonthSelector | null;
  command_name: 'issue_income_document';
};

export type WorkEngineRecurringCycleDraftReviewIssueAndSendAction = {
  visible: boolean;
  enabled: boolean;
  disabled_reason: string | null;
  icon: 'send';
  tooltip: string;
  confirmation_required: boolean;
  confirmation_title: string | null;
  confirmation_message: string | null;
  issue_month_selector: WorkEngineRecurringCycleDraftReviewIssueMonthSelector | null;
  command_name: 'issue_and_send_income_document';
};

export type WorkEngineRecurringCycleDraftReviewDeliveryOutcome = {
  status: 'not_attempted' | 'sent' | 'failed';
  failure_reason: string | null;
  delivery_attempt_id: string | null;
};

export type WorkEngineRecurringCycleDraftReviewAggregate = {
  aggregate_key: 'work_engine_recurring_cycle_draft_review_aggregate';
  represented_client_id: string;
  profile_id: string;
  cycle_id: string;
  generated_draft_id: string;
  period_key: string;
  linked_work_item_id: string | null;
  scheduled_document_date_display: string;
  title: string;
  issued_document_id: string | null;
  issued_document_number_display: string | null;
  delivery_outcome: WorkEngineRecurringCycleDraftReviewDeliveryOutcome | null;
  status_message: string | null;
  initial_view: 'document_preview';
  edit_action: WorkEngineRecurringCycleDraftReviewEditAction;
  issue_action: WorkEngineRecurringCycleDraftReviewIssueAction;
  issue_and_send_action: WorkEngineRecurringCycleDraftReviewIssueAndSendAction;
  income_workspace_aggregate: IncomeWorkspaceAggregate;
  income_commands: Record<string, string>;
  preview_action: {
    visible: boolean;
    label: string;
    disabled_reason: string | null;
  };
  allowed_actions: string[];
};

export type WorkEngineInvoiceRetainerScheduleProjectionRow = {
  projection_key: string;
  cycle_id: string | null;
  generated_draft_id: string | null;
  linked_work_item_id: string | null;
  period_key: string;
  scheduled_document_date: string;
  scheduled_document_date_display: string;
  document_type_label: string;
  amount_display: string;
  status_key: 'issued' | 'waiting_review' | 'scheduled' | 'skipped' | 'failed';
  status_label: string;
  show_status_text: boolean;
  status_tone: 'success' | 'neutral' | 'warning' | 'danger' | 'muted';
  icon_key: 'check' | 'calendar' | 'pause' | 'alert' | 'review';
  icon_display: string;
  work_state_label: string | null;
  has_open_task: boolean;
  work_item_href: string | null;
  machine_state: string | null;
  machine_state_label: string | null;
  machine_state_tone: 'primary' | 'success' | 'warning' | 'danger' | 'neutral' | 'muted' | null;
  machine_has_task: boolean;
  machine_task_id: string | null;
  machine_task_url: string | null;
  machine_task_title: string | null;
  row_interaction_kind:
    | 'generated_draft_review'
    | 'next_document_projection'
    | 'future_projection'
    | null;
  primary_action: WorkEngineInvoiceRetainerScheduleRowPrimaryAction | null;
  preview_action: WorkEngineInvoiceRetainerScheduleRowPreviewAction | null;
  override_exists: boolean;
  override_scope: RecurringCycleOverrideScope | null;
  cycle_date: string;
  allowed_actions: string[];
  actions: WorkEngineInvoiceRetainerScheduleProjectionAction[];
};

export type WorkEngineInvoiceRetainerScheduleProjectionYear = {
  year: number;
  label: string;
  total_count: number;
  total_count_label: string;
  yearly_total_amount_display: string;
  expanded_by_default: boolean;
  rows: WorkEngineInvoiceRetainerScheduleProjectionRow[];
};

export type WorkEngineInvoiceRetainerScheduleProjectionSummary = {
  title: string;
  cycle_label: string;
  cycle_display: string;
  status_label: string;
  documents_in_horizon_label: string;
  documents_in_horizon_count: number;
  next_document_label: string;
  next_document_date_display: string;
  next_document_date_source?: 'schedule_projection';
};

export type WorkEngineInvoiceRetainerScheduleProjection = {
  status: 'ready' | 'unavailable';
  unavailable_message: string | null;
  summary: WorkEngineInvoiceRetainerScheduleProjectionSummary | null;
  recurrence_rule_display: string | null;
  default_expanded_year: number | null;
  years: WorkEngineInvoiceRetainerScheduleProjectionYear[];
};

export interface WorkEngineInvoiceRetainerTemplateDraftState {
  status: 'ready' | 'missing';
  prompt_message: string;
  confirm_begin_label: string;
  cancel_label: string;
  begin_document_type: 'quote' | 'deal_invoice' | 'tax_invoice';
  begin_income_customer_id: string;
}

export interface WorkEngineInvoiceRetainerSaveProfilePrompt {
  message: string;
  confirm_label: string;
  cancel_label: string;
}

export interface WorkEngineInvoiceRetainerIssueDocumentAction {
  visible: boolean;
  label: string;
  disabled_reason: string | null;
}

export interface WorkEngineInvoiceRetainerSetupAggregate {
  aggregate_key: 'work_engine_invoice_retainer_setup_aggregate';
  represented_client_id: string;
  client_display_name: string;
  selected_end_customer_id: string | null;
  identity: {
    office_client_label: string;
    end_customer_label: string;
  } | null;
  document_type_options: Array<{
    key: 'quote' | 'deal_invoice' | 'tax_invoice';
    label: string;
    enabled: boolean;
    disabled_reason: string | null;
  }>;
  end_customers: WorkEngineInvoiceRetainerEndCustomerRow[];
  document_draft_workspace: WorkEngineInvoiceRetainerDocumentDraftWorkspace | null;
  template_draft: WorkEngineInvoiceRetainerTemplateDraftState | null;
  save_profile_without_template_prompt: WorkEngineInvoiceRetainerSaveProfilePrompt | null;
  issue_document_action: WorkEngineInvoiceRetainerIssueDocumentAction | null;
  retainer_settings: WorkEngineInvoiceRetainerSettings | null;
  child_documents_history: WorkEngineInvoiceRetainerChildDocumentHistoryRow[];
  setup_tabs: {
    default_tab_key: 'retainer';
    tabs: WorkEngineInvoiceRetainerSetupTab[];
  };
  next_document_preview: WorkEngineInvoiceRetainerNextDocumentPreview;
  retainer_schedule_projection: WorkEngineInvoiceRetainerScheduleProjection;
  recurring_profiles: Array<{
    profile_id: string;
    end_customer_id: string;
    end_customer_display_name: string;
    document_type_label: string;
    frequency_label: string;
    status: RecurringProfileStatus;
    status_label: string;
    next_document_date_display: string;
  }>;
  frequency_options: Array<{ key: RecurringDocumentFrequency; label: string }>;
  default_values: {
    advance_days: number;
    auto_advance_period: boolean;
  };
  allowed_actions: string[];
  scheduler_status: RecurringSchedulerStatus;
  scheduler_note: string;
  work_engine_event_type: string;
  work_type: string;
}

export type WorkEngineInvoiceRetainerCommandType =
  | 'create_income_recurring_document_profile'
  | 'update_income_recurring_document_profile'
  | 'pause_income_recurring_document_profile'
  | 'resume_income_recurring_document_profile'
  | 'cancel_income_recurring_document_profile'
  | 'preview_income_recurring_document_profile_settings'
  | 'open_recurring_cycle_draft_for_review'
  | 'open_recurring_cycle_override_for_edit'
  | 'preview_recurring_cycle_override'
  | 'refresh_recurring_cycle_override_step'
  | 'save_recurring_cycle_override'
  | 'delete_recurring_cycle_override';

export interface WorkEngineInvoiceRetainerCommandResponse {
  ok: true;
  command: WorkEngineInvoiceRetainerCommandType | string;
  work_engine_invoice_retainer_setup_aggregate?: WorkEngineInvoiceRetainerSetupAggregate;
  work_engine_recurring_cycle_draft_review_aggregate?: WorkEngineRecurringCycleDraftReviewAggregate;
  work_engine_recurring_cycle_override_aggregate?: WorkEngineRecurringCycleOverrideAggregate;
  work_engine_invoices_tab_aggregate?: Record<string, unknown>;
}

export interface IncomeClientDocumentManagementReportItem {
  key: string;
  label: string;
  enabled: boolean;
  disabled_reason: string | null;
}

export interface IncomeClientDocumentManagementPanel {
  aggregate_key: 'income_client_document_management_panel';
  visible: boolean;
  title: string;
  description: string | null;
  columns: Array<{ key: string; label: string }>;
  /**
   * Legacy flat list = office_clients_section.rows only.
   * Dual-population UI must use the explicit sections below.
   */
  rows: IncomeClientDocumentManagementRow[];
  office_clients_section: IncomeClientDocumentManagementSection;
  office_client_customers_section: IncomeClientDocumentManagementSection;
  report_catalog: IncomeClientDocumentManagementReportItem[];
  empty_state: {
    visible: boolean;
    title: string;
    description: string | null;
  };
}

export interface IncomeClientIncomeLedgerCardEndCustomerOption {
  end_customer_id: string;
  display_name: string;
  tax_id: string | null;
  email: string | null;
  open_balance_display: string;
  open_balance_reference: number;
  open_invoice_count: number;
  currency: string;
}

export type IncomeIssuedDocumentViewAction = {
  action_key: 'open_document';
  label: string;
  enabled: boolean;
  view_mode: 'issued_html';
  income_document_id: string;
  view_aggregate_key: 'income_issued_document_view_aggregate';
  view_aggregate_params: { income_document_id: string };
  disabled_reason: string | null;
};

export type IncomeIssuedDocumentPdfAction = {
  action_key: 'download_pdf';
  label: string;
  enabled: boolean;
  income_document_id: string;
  pdf_download_path: string | null;
  pdf_status_key: 'pdf_pending' | 'pdf_failed' | 'pdf_ready' | 'pdf_unavailable';
  pdf_status_label: string;
  disabled_reason: string | null;
  retry_command: 'retry_income_document_pdf_render' | null;
};

export interface IncomeIssuedDocumentViewAggregate {
  aggregate_key: 'income_issued_document_view_aggregate';
  income_document_id: string;
  document_number: string;
  document_type_label: string;
  title: string;
  read_only: true;
  view_mode: 'issued_html';
  document_html: string;
  allocation_number_field: import('./income-document-details-types').IncomeDocumentAllocationNumberField;
  pdf_action: IncomeIssuedDocumentPdfAction;
  email_delivery: IncomeDocumentEmailDeliveryBlock;
  docflow_delivery: IncomeDocumentDocflowDeliveryBlock;
  allowed_actions: string[];
};

export interface IncomeClientIncomeLedgerCardPaymentChild {
  payment_id: string;
  allocation_id: string;
  cashbox_display: string;
  payment_date_display: string;
  amount_display: string;
}

export interface IncomeClientIncomeLedgerCardInvoiceGroup {
  income_document_id: string;
  document_type_label: string;
  document_number: string;
  issue_date_display: string;
  original_amount_display: string;
  remaining_balance_display: string;
  remaining_balance_tone: 'open' | 'zero';
  view_action: IncomeIssuedDocumentViewAction | null;
  payments: IncomeClientIncomeLedgerCardPaymentChild[];
}

export interface IncomeClientIncomeLedgerCardRenderRow {
  row_id: string;
  row_kind: 'invoice' | 'payment';
  visual_role: 'parent' | 'child';
  document_type_label: string;
  document_number: string;
  issue_date_display: string;
  original_amount_display: string;
  remaining_balance_display: string;
  amount_tone: 'default' | 'payment';
  view_action: IncomeIssuedDocumentViewAction | null;
}

export interface IncomeClientIncomeLedgerCardTopAction {
  key: string;
  label: string;
  icon_key: 'send' | 'print';
  enabled: boolean;
  disabled_reason: string | null;
}

export interface IncomeClientIncomeLedgerCardAggregate {
  aggregate_key: 'income_client_income_ledger_card_aggregate';
  financial_source: 'accounting_base';
  represented_client_id: string;
  represented_client_display_name: string;
  selected_end_customer_id: string | null;
  selected_end_customer_display_name: string | null;
  selected_year: number;
  available_years: number[];
  end_customer_options: IncomeClientIncomeLedgerCardEndCustomerOption[];
  show_customer_picker: false;
  user_notice: string | null;
  summary: {
    total_debit_display: string;
    total_credit_display: string;
    open_balance_display: string;
    invoice_count: number;
    payment_count: number;
    currency: string;
  };
  customer_credit?: {
    visible: boolean;
    label: string;
    amount_display: string;
    amount_reference: number;
    status_label: string;
    financial_source: 'accounting_base';
  };
  table_columns: Array<{ key: string; label: string }>;
  documents: IncomeClientIncomeLedgerCardInvoiceGroup[];
  rows: IncomeClientIncomeLedgerCardRenderRow[];
  allowed_actions: string[];
  top_actions: IncomeClientIncomeLedgerCardTopAction[];
  empty_state: {
    visible: boolean;
    title: string;
    description: string | null;
  };
  document_download_path_template: string;
}

/** Safe fallback when backend aggregate predates client_document_management_panel. */
const EMPTY_CDM_SECTION_PAGE = { limit: 50, offset: 0, has_more: false } as const;

function emptyOfficeClientsSection(
  rows: IncomeClientDocumentManagementRow[] = [],
): IncomeClientDocumentManagementSection {
  return {
    section_key: 'office_clients',
    title: 'לקוחות המשרד',
    total_count: rows.length,
    rows,
    groups: null,
    page: { ...EMPTY_CDM_SECTION_PAGE },
    header_actions: [],
    empty_state: {
      visible: rows.length === 0,
      title: '',
      description: null,
    },
  };
}

function emptyOfficeClientCustomersSection(): IncomeClientDocumentManagementSection {
  return {
    section_key: 'office_client_customers',
    title: 'לקוחות של לקוחות המשרד',
    total_count: 0,
    rows: [],
    groups: [],
    page: { ...EMPTY_CDM_SECTION_PAGE },
    header_actions: [],
    empty_state: {
      visible: true,
      title: '',
      description: null,
    },
  };
}

function normalizeCdmRow(row: IncomeClientDocumentManagementRow): IncomeClientDocumentManagementRow {
  return {
    ...row,
    actions: row.actions ?? [],
    document_type_counters: row.document_type_counters ?? [],
  };
}

function normalizeCdmSectionPage(
  page: IncomeClientDocumentManagementSectionPage | null | undefined,
): IncomeClientDocumentManagementSectionPage {
  const limitRaw = page?.limit;
  const limit =
    typeof limitRaw === 'number' && Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.floor(limitRaw)
      : EMPTY_CDM_SECTION_PAGE.limit;
  const offsetRaw = page?.offset;
  const offset =
    typeof offsetRaw === 'number' && Number.isFinite(offsetRaw) && offsetRaw >= 0
      ? Math.floor(offsetRaw)
      : EMPTY_CDM_SECTION_PAGE.offset;
  return {
    limit,
    offset,
    has_more: Boolean(page?.has_more),
  };
}

function normalizeCdmSection(
  section: IncomeClientDocumentManagementSection | null | undefined,
  fallback: IncomeClientDocumentManagementSection,
): IncomeClientDocumentManagementSection {
  if (!section || typeof section.section_key !== 'string') {
    return fallback;
  }
  const rows = (section.rows ?? []).map(normalizeCdmRow);
  const groups =
    section.groups == null
      ? section.section_key === 'office_client_customers'
        ? []
        : null
      : section.groups.map((group) => ({
          ...group,
          rows: (group.rows ?? []).map(normalizeCdmRow),
        }));
  return {
    ...fallback,
    ...section,
    rows,
    groups,
    header_actions: Array.isArray(section.header_actions) ? section.header_actions : [],
    page: normalizeCdmSectionPage(section.page),
    empty_state: {
      ...fallback.empty_state,
      ...(section.empty_state ?? {}),
    },
  };
}

export const EMPTY_INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL: IncomeClientDocumentManagementPanel = {
  aggregate_key: 'income_client_document_management_panel',
  visible: false,
  title: 'ניהול מסמכים לפי לקוח',
  description: null,
  columns: [],
  rows: [],
  office_clients_section: emptyOfficeClientsSection(),
  office_client_customers_section: emptyOfficeClientCustomersSection(),
  report_catalog: [],
  empty_state: {
    visible: false,
    title: '',
    description: null,
  },
};

export function resolveIncomeClientDocumentManagementPanel(
  panel:
    | (Omit<
        IncomeClientDocumentManagementPanel,
        'office_clients_section' | 'office_client_customers_section'
      > & {
        office_clients_section?: IncomeClientDocumentManagementSection;
        office_client_customers_section?: IncomeClientDocumentManagementSection;
      })
    | null
    | undefined,
): IncomeClientDocumentManagementPanel {
  if (!panel || typeof panel.visible !== 'boolean') {
    return EMPTY_INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL;
  }
  const rows = (panel.rows ?? []).map(normalizeCdmRow);
  /**
   * Explicit sections only. Never reclassify legacy `rows` into end-customer population.
   * If office section is missing, treat legacy `rows` as office clients (backward compat).
   */
  const office_clients_section = normalizeCdmSection(
    panel.office_clients_section,
    emptyOfficeClientsSection(rows),
  );
  const office_client_customers_section = normalizeCdmSection(
    panel.office_client_customers_section,
    emptyOfficeClientCustomersSection(),
  );
  return {
    ...EMPTY_INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL,
    ...panel,
    columns: panel.columns ?? [],
    rows: panel.office_clients_section ? office_clients_section.rows : rows,
    office_clients_section,
    office_client_customers_section,
    report_catalog: panel.report_catalog ?? [],
    empty_state: {
      ...EMPTY_INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL.empty_state,
      ...(panel.empty_state ?? {}),
    },
  };
}


export interface IncomeWorkspaceContextAggregate {
  aggregate_key: 'income_workspace_context_aggregate';
  org_id: string;
  actor_user_id: string;
  acting_mode: IncomeActingMode;
  active_issuer_business_id: string;
  represented_client_id: string | null;
  issuer_label: string;
  represented_client_label: string | null;
  allowed_acting_modes: IncomeAllowedActingMode[];
  issuer_options: IncomeIssuerOption[];
  permissions: IncomeWorkspacePermissions;
  allowed_actions: string[];
  warnings: IncomeWorkspaceWarning[];
  client_document_management_panel?: IncomeClientDocumentManagementPanel;
}

export interface IncomeIssuerContextSummary {
  acting_mode: IncomeActingMode;
  active_issuer_business_id: string;
  represented_client_id: string | null;
  issuer_label: string;
  represented_client_label: string | null;
}

export interface IncomeWorkspaceCard {
  key: string;
  label: string;
  count: number | null;
  allowed_actions: string[];
  disabled?: boolean;
  disabled_reason?: string | null;
}

export interface IncomeTableColumn {
  key: string;
  label: string;
}

export interface IncomeCustomerEditorField {
  key: string;
  label: string;
  input_type: 'text' | 'select';
  required: boolean;
  options?: { value: string; label: string }[];
  default_value?: string | null;
}

export interface IncomeCustomersTableRow {
  customer_id: string;
  display_name: string;
  phone: string | null;
  email: string | null;
  tax_id: string | null;
  default_payment_terms: string;
  default_payment_terms_label: string;
  is_one_time: boolean;
  status: string;
  status_label: string;
  created_at: string;
}

export interface IncomeItemsTableRow {
  item_id: string;
  item_type: IncomeItemType;
  item_type_label: string;
  name: string;
  description: string | null;
  default_unit_price_reference: number | null;
  currency: string | null;
  active: boolean;
  created_at: string;
}

export interface IncomeDraftsTableRow {
  draft_id: string;
  document_type: IncomeDocumentType | null;
  document_type_label: string | null;
  status: string;
  status_label: string;
  income_customer_id: string | null;
  customer_display_name: string | null;
  line_count: number;
  updated_at: string;
  allowed_actions: string[];
}

export const INCOME_DOCUMENT_EMAIL_HISTORY_AGGREGATE_KEY =
  'income_document_email_history_aggregate' as const;
export const INCOME_REPRESENTED_CLIENT_EMAIL_HISTORY_AGGREGATE_KEY =
  'income_represented_client_email_history_aggregate' as const;
export const INCOME_DOCUMENT_DOCFLOW_SEND_AGGREGATE_KEY =
  'income_document_docflow_send_aggregate' as const;

export interface IncomeDocumentDocflowDeliveryAction {
  key: 'open_docflow_send';
  icon_key: 'docflow';
  label: string;
  enabled: boolean;
  disabled_reason: string | null;
  send_aggregate_key: typeof INCOME_DOCUMENT_DOCFLOW_SEND_AGGREGATE_KEY;
  send_aggregate_params: { income_document_id: string };
}

export interface IncomeDocumentDocflowDeliveryBlock {
  attempt_count: number;
  status_label: string;
  send_enabled: boolean;
  send_disabled_reason: string | null;
  action: IncomeDocumentDocflowDeliveryAction;
}

export interface IncomeDocumentDocflowHistoryAttemptRow {
  attempt_id: string;
  sent_at_display: string | null;
  result: 'pending' | 'sent' | 'failed';
  result_label: string;
  failure_reason: string | null;
  docflow_thread_id: string | null;
  docflow_message_id: string | null;
  body_preview: string | null;
}

export interface IncomeDocumentDocflowSendForm {
  visible: boolean;
  command: 'send_income_document_by_docflow';
  income_document_id: string;
  confirm_label: string;
  fields: [];
  enabled: boolean;
  disabled_reason: string | null;
}

export type IncomeDocumentPdfSendStatusKey =
  | 'pdf_pending'
  | 'pdf_failed'
  | 'pdf_ready'
  | 'pdf_unavailable';

export interface IncomeDocumentPdfSendReadinessView {
  status_key: IncomeDocumentPdfSendStatusKey;
  status_label: string;
  message: string | null;
}

export interface IncomeDocumentDocflowSendAggregate {
  aggregate_key: typeof INCOME_DOCUMENT_DOCFLOW_SEND_AGGREGATE_KEY;
  income_document_id: string;
  document_number: string;
  document_type_label: string;
  represented_client_id: string | null;
  client_display_name: string | null;
  pdf_send_readiness: IncomeDocumentPdfSendReadinessView;
  table_columns: Array<{ key: string; label: string }>;
  rows: IncomeDocumentDocflowHistoryAttemptRow[];
  send_form: IncomeDocumentDocflowSendForm;
  allowed_actions: string[];
  empty_state: { visible: boolean; title: string; description: string | null };
}

export interface IncomeDocumentEmailDeliveryAction {
  key: 'open_email_history';
  icon_key: 'at';
  label: string;
  enabled: boolean;
  disabled_reason: string | null;
  history_aggregate_key: typeof INCOME_DOCUMENT_EMAIL_HISTORY_AGGREGATE_KEY;
  history_aggregate_params: { income_document_id: string };
}

export interface IncomeDocumentEmailDeliveryBlock {
  attempt_count: number;
  status_label: string;
  send_enabled: boolean;
  send_disabled_reason: string | null;
  action: IncomeDocumentEmailDeliveryAction;
}

export interface IncomeDocumentEmailHistoryAttemptRow {
  attempt_id: string;
  sent_at_display: string | null;
  recipient_email: string | null;
  result: 'pending' | 'sent' | 'failed';
  result_label: string;
  failure_reason: string | null;
  provider_message_id: string | null;
  subject_preview: string | null;
}

export interface IncomeDocumentEmailSendFormField {
  key: string;
  label: string;
  required: boolean;
  type: 'email';
  default_value?: string | null;
}

export interface IncomeDocumentEmailSendForm {
  visible: boolean;
  command: 'send_income_document_by_email';
  income_document_id: string;
  fields: IncomeDocumentEmailSendFormField[];
  enabled: boolean;
  disabled_reason: string | null;
}

export interface IncomeDocumentEmailSendView {
  title: string;
  sender_label: string;
  sender_display_name: string;
  recipient_name_label: string;
  recipient_display_name: string;
  document_label: string;
  document_display: string;
  attachment_filename: string | null;
  attachment_ready: boolean;
  email_label: string;
  email_editable: boolean;
  send_button_label: string;
  send_disabled_user_message: string | null;
  history_toggle_label: string;
  history_available: boolean;
}

export interface IncomeDocumentEmailHistoryAggregate {
  aggregate_key: typeof INCOME_DOCUMENT_EMAIL_HISTORY_AGGREGATE_KEY;
  income_document_id: string;
  document_number: string;
  document_type_label: string;
  represented_client_id: string | null;
  recipient_email_default: string | null;
  table_columns: Array<{ key: string; label: string }>;
  rows: IncomeDocumentEmailHistoryAttemptRow[];
  send_form: IncomeDocumentEmailSendForm;
  send_view: IncomeDocumentEmailSendView;
  allowed_actions: string[];
  empty_state: { visible: boolean; title: string; description: string | null };
}

export interface IncomeRepresentedClientEmailHistoryAttemptRow {
  attempt_id: string;
  income_document_id: string;
  document_number: string | null;
  document_type_label: string | null;
  sent_at_display: string | null;
  recipient_email: string | null;
  result: 'pending' | 'sent' | 'failed';
  result_label: string;
  failure_reason: string | null;
  subject_preview: string | null;
}

export interface IncomeRepresentedClientEmailHistoryAggregate {
  aggregate_key: typeof INCOME_REPRESENTED_CLIENT_EMAIL_HISTORY_AGGREGATE_KEY;
  represented_client_id: string;
  /** Present when history is scoped to a single end customer. */
  income_customer_id?: string | null;
  /**
   * Primary identity for the modal title.
   * Recipient display name when income_customer_id is scoped; otherwise issuer/client.
   */
  client_display_name: string;
  /**
   * Ready-to-render secondary issuer line when history is recipient-scoped
   * (e.g. "מנפיק: Test3"). Null for issuer-level history.
   */
  issuer_context_label: string | null;
  table_columns: Array<{ key: string; label: string }>;
  rows: IncomeRepresentedClientEmailHistoryAttemptRow[];
  allowed_actions: string[];
  empty_state: { visible: boolean; title: string; description: string | null };
}

export interface IncomeIssuedDocumentsTableRow {
  document_id: string;
  document_number: string;
  document_type: IncomeDocumentType;
  document_type_label: string;
  document_status: string;
  document_status_label: string;
  customer_display_name: string | null;
  issue_date: string;
  currency: string;
  line_count: number;
  source_draft_id: string | null;
  created_at: string;
  accounting_posting_status: string;
  accounting_status_label: string;
  accounting_display_status: string;
  accounting_entry_id: string | null;
  accounting_entry_reference: string | null;
  pdf_render_status: string;
  pdf_status_label: string;
  pdf_asset_id: string | null;
  pdf_download_path: string | null;
  email_delivery: IncomeDocumentEmailDeliveryBlock;
  docflow_delivery: IncomeDocumentDocflowDeliveryBlock;
  allowed_actions: string[];
}

export interface IncomeTableModel<T> {
  columns: IncomeTableColumn[];
  rows: T[];
  empty_state: { visible: boolean; title: string; description: string | null };
  editor_fields?: IncomeCustomerEditorField[];
}

export interface IncomeAvailableDocumentType {
  key: IncomeDocumentType;
  label: string;
  enabled: boolean;
  disabled_reason: string | null;
  requires_payment_received: boolean;
  requires_due_date: boolean;
  allows_credit: boolean;
  source: string;
  country_code: string;
  ruleset_id: string | null;
  legal_hint: string | null;
}

export interface IncomeDocumentCreationStep {
  key: string;
  label: string;
  required: boolean | 'depends_on_document_type';
}

export interface IncomeDocumentCreationSchema {
  steps: IncomeDocumentCreationStep[];
  allowed_actions: string[];
}

export interface IncomeRecipientListRow {
  income_customer_id: string;
  display_name: string;
  tax_id: string | null;
  phone: string | null;
  email: string | null;
  address_line: string | null;
  city: string | null;
  display_line: string;
}

export interface IncomeRecipientCreateFieldSchema {
  key: string;
  label: string;
  required: boolean;
  input_type: 'text' | 'checkbox';
  placeholder: string | null;
}

export type IncomeRecipientSelected =
  | {
      kind: 'saved';
      income_customer_id: string;
      display_line: string;
      snapshot: null;
    }
  | {
      kind: 'snapshot';
      income_customer_id: null;
      display_line: string;
      snapshot: Record<string, unknown>;
    };

export interface IncomeRecipientSearchModel {
  label: string;
  placeholder: string;
  recent_recipients: IncomeRecipientListRow[];
  search_results: IncomeRecipientListRow[];
  empty_state: { visible: boolean; message: string };
  create_new_action: { label: string; enabled: boolean; disabled_reason: string | null };
  create_fields_schema: IncomeRecipientCreateFieldSchema[];
  save_for_future_label: string;
  save_for_future_available: boolean;
  selected: IncomeRecipientSelected | null;
  field_errors: Record<string, string>;
  allowed_actions: string[];
}

import type { IncomeDocumentDetailsStep } from './income-document-details-types.js';
import type {
  IncomeDocumentBrandingProfileAggregate,
  IncomeDocumentBrandingSettingsEntrypoint,
} from './income-document-branding-types.js';

export type { IncomeDocumentDetailsStep } from './income-document-details-types.js';

export interface IncomeWorkspaceAggregate {
  aggregate_key: 'income_workspace_aggregate';
  org_id: string;
  actor_user_id: string;
  issuer_context: IncomeIssuerContextSummary;
  available_document_types: IncomeAvailableDocumentType[];
  document_creation_schema: IncomeDocumentCreationSchema;
  cards: IncomeWorkspaceCard[];
  customers_table_model: IncomeTableModel<IncomeCustomersTableRow>;
  items_table_model: IncomeTableModel<IncomeItemsTableRow>;
  drafts_table_model: IncomeTableModel<IncomeDraftsTableRow>;
  issued_documents_table_model: IncomeTableModel<IncomeIssuedDocumentsTableRow>;
  issued_documents_count: number;
  recipient_search: IncomeRecipientSearchModel;
  document_details_step: IncomeDocumentDetailsStep | null;
  wizard_starting_step_key?: string | null;
  active_wizard_draft_id: string | null;
  document_branding_profile: IncomeDocumentBrandingProfileAggregate | null;
  document_branding_settings_entrypoint: IncomeDocumentBrandingSettingsEntrypoint | null;
  allowed_actions: string[];
  warnings: IncomeWorkspaceWarning[];
}

export type IncomeCommandType =
  | 'select_income_issuer_context'
  | 'create_income_customer'
  | 'create_income_customer_for_issuer'
  | 'update_income_customer_for_issuer'
  | 'create_one_time_income_customer'
  | 'create_income_item'
  | 'create_income_document_draft'
  | 'update_income_document_draft'
  | 'cancel_income_document_draft'
  | 'issue_income_document'
  | 'search_income_recipients'
  | 'select_income_recipient'
  | 'set_income_recipient_snapshot'
  | 'save_income_recipient_for_future'
  | 'retry_income_document_accounting_posting'
  | 'retry_income_document_pdf_render'
  | 'send_income_document_by_email'
  | 'send_income_document_by_docflow'
  | 'begin_income_wizard_document_draft'
  | 'add_income_document_line'
  | 'update_income_document_line'
  | 'delete_income_document_line'
  | 'reorder_income_document_lines'
  | 'update_income_document_draft_settings'
  | 'update_income_document_notes'
  | 'update_income_document_delivery_contact'
  | 'save_income_document_draft'
  | 'resume_income_document_draft'
  | 'generate_income_document_preview'
  | 'update_income_document_discount';

export interface IncomeCommandResponseMeta {
  workspace_aggregate_mode?: 'full' | 'wizard_patch';
  idempotent_replay?: boolean;
  income_document_id?: string;
  delivery_attempt_id?: string;
  delivery_result?: 'sent' | 'failed';
  provider_message_id?: string | null;
  docflow_thread_id?: string | null;
  docflow_message_id?: string | null;
  failure_reason?: string | null;
}

export interface IncomeCommandResponse {
  ok: true;
  command: IncomeCommandType;
  income_workspace_aggregate: IncomeWorkspaceAggregate;
  work_engine_recurring_cycle_draft_review_aggregate?: WorkEngineRecurringCycleDraftReviewAggregate;
  work_engine_invoice_retainer_setup_aggregate?: WorkEngineInvoiceRetainerSetupAggregate;
  income_document_email_history_aggregate?: IncomeDocumentEmailHistoryAggregate;
  meta?: IncomeCommandResponseMeta;
}

export interface SelectIncomeIssuerContextCommandResponse {
  ok: true;
  command: 'select_income_issuer_context';
  income_workspace_context_aggregate: IncomeWorkspaceContextAggregate;
  income_workspace_aggregate: IncomeWorkspaceAggregate;
}
