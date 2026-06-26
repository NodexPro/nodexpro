/**
 * Work Engine invoice retainer — types.
 */

import type {
  IncomeDocumentDetailsStep,
  IncomeDocumentType,
  IncomeWorkspaceAggregate,
} from '../income/income.types.js';
import type {
  RecurringDocumentFrequency,
  RecurringPriceIncreaseType,
  RecurringProfileStatus,
  RecurringSchedulerStatus,
} from './work-engine-invoice-retainer.pure.js';
import type { RecurringDocumentTemplateSnapshot } from './work-engine-invoice-retainer-draft.service.js';

export const WORK_ENGINE_INVOICE_RETAINER_SETUP_AGGREGATE_KEY =
  'work_engine_invoice_retainer_setup_aggregate' as const;

export const WORK_ENGINE_INVOICE_RETAINER_COMMANDS = {
  create: 'create_income_recurring_document_profile',
  update: 'update_income_recurring_document_profile',
  pause: 'pause_income_recurring_document_profile',
  resume: 'resume_income_recurring_document_profile',
  cancel: 'cancel_income_recurring_document_profile',
  preview: 'preview_income_recurring_document_profile_settings',
} as const;

export type WorkEngineInvoiceRetainerCommandType =
  (typeof WORK_ENGINE_INVOICE_RETAINER_COMMANDS)[keyof typeof WORK_ENGINE_INVOICE_RETAINER_COMMANDS];

export type WorkEngineInvoiceRetainerEndCustomerRow = {
  end_customer_id: string;
  display_name: string;
  email: string | null;
  tax_id: string | null;
  selectable: boolean;
  recurring_profile_id: string | null;
  profile_status: RecurringProfileStatus | null;
  profile_status_label: string | null;
  profile_summary: string | null;
};

/** Recurring-only settings — document body lives in income draft workspace. */
export type WorkEngineInvoiceRetainerSettings = {
  profile_id: string | null;
  end_customer_id: string;
  end_customer_display_name: string;
  source_draft_template_id: string | null;
  document_template_snapshot: RecurringDocumentTemplateSnapshot | null;
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
};

export type WorkEngineInvoiceRetainerTemplateDraftState = {
  status: 'ready' | 'missing';
  prompt_message: string;
  confirm_begin_label: string;
  cancel_label: string;
  begin_document_type: 'quote' | 'deal_invoice' | 'tax_invoice';
  begin_income_customer_id: string;
};

export type WorkEngineInvoiceRetainerSaveProfilePrompt = {
  message: string;
  confirm_label: string;
  cancel_label: string;
};

export type WorkEngineInvoiceRetainerIssueDocumentAction = {
  visible: boolean;
  label: string;
  disabled_reason: string | null;
};

export type WorkEngineInvoiceRetainerDocumentDraftWorkspace = {
  income_workspace_aggregate: IncomeWorkspaceAggregate;
  income_commands: Record<string, string>;
};

export type WorkEngineInvoiceRetainerSetupTabKey = 'retainer' | 'next_document' | 'schedule';

export type WorkEngineInvoiceRetainerSetupTab = {
  key: WorkEngineInvoiceRetainerSetupTabKey;
  label: string;
  enabled: boolean;
  disabled_reason: string | null;
};

export type WorkEngineInvoiceRetainerNextDocumentApplyScope = 'next_cycle_only' | 'all_future_cycles';

export type WorkEngineInvoiceRetainerNextDocumentPreviewInfoBlock = {
  title: string;
  document_type_label: string | null;
  next_document_date_display: string | null;
  draft_review_date_label: string;
  draft_review_date_display: string | null;
  draft_review_advance_note: string | null;
  profile_status_label: string | null;
};

export type WorkEngineInvoiceRetainerNextDocumentPreview = {
  status: 'ready' | 'unavailable';
  unavailable_message: string | null;
  projection_id: string | null;
  next_document_date: string | null;
  next_document_date_display: string | null;
  price_increase_applied: boolean;
  price_increase_note: string | null;
  info_block: WorkEngineInvoiceRetainerNextDocumentPreviewInfoBlock;
  document_details_step: IncomeDocumentDetailsStep | null;
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
};

export type WorkEngineInvoiceRetainerScheduleProjectionAction = {
  key: string;
  label: string;
  disabled: boolean;
  disabled_reason: string | null;
};

export type WorkEngineInvoiceRetainerScheduleProjectionRow = {
  projection_key: string;
  scheduled_document_date: string;
  scheduled_document_date_display: string;
  document_type_label: string;
  amount_display: string;
  status_key: 'issued' | 'scheduled' | 'skipped' | 'failed';
  status_label: string;
  status_tone: 'success' | 'neutral' | 'warning' | 'danger';
  icon_key: 'check' | 'clock' | 'pause' | 'alert';
  allowed_actions: string[];
  actions: WorkEngineInvoiceRetainerScheduleProjectionAction[];
};

export type WorkEngineInvoiceRetainerScheduleProjectionYear = {
  year: number;
  label: string;
  total_count: number;
  total_count_label: string;
  rows: WorkEngineInvoiceRetainerScheduleProjectionRow[];
};

export type WorkEngineInvoiceRetainerScheduleProjection = {
  status: 'ready' | 'unavailable';
  unavailable_message: string | null;
  years: WorkEngineInvoiceRetainerScheduleProjectionYear[];
};

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

export type WorkEngineInvoiceRetainerSetupAggregate = {
  aggregate_key: typeof WORK_ENGINE_INVOICE_RETAINER_SETUP_AGGREGATE_KEY;
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
};

export type WorkEngineInvoiceRetainerCommandResponse = {
  ok: true;
  command: WorkEngineInvoiceRetainerCommandType;
  work_engine_invoice_retainer_setup_aggregate: WorkEngineInvoiceRetainerSetupAggregate;
  work_engine_invoices_tab_aggregate?: Record<string, unknown>;
};
