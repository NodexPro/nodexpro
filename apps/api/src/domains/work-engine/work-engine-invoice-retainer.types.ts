/**
 * Work Engine invoice retainer — types.
 */

import type { IncomeDocumentType, IncomeWorkspaceAggregate } from '../income/income.types.js';
import type {
  RecurringDocumentFrequency,
  RecurringPriceIncreaseType,
  RecurringProfileStatus,
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
  frequency: RecurringDocumentFrequency;
  frequency_label: string;
  advance_days: number;
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
};

export type WorkEngineInvoiceRetainerDocumentDraftWorkspace = {
  income_workspace_aggregate: IncomeWorkspaceAggregate;
  income_commands: Record<string, string>;
};

export type WorkEngineInvoiceRetainerSetupAggregate = {
  aggregate_key: typeof WORK_ENGINE_INVOICE_RETAINER_SETUP_AGGREGATE_KEY;
  represented_client_id: string;
  client_display_name: string;
  selected_end_customer_id: string | null;
  end_customers: WorkEngineInvoiceRetainerEndCustomerRow[];
  document_draft_workspace: WorkEngineInvoiceRetainerDocumentDraftWorkspace | null;
  retainer_settings: WorkEngineInvoiceRetainerSettings | null;
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
  scheduler_status: 'scheduler_pending';
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
