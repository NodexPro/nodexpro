import type { IncomeDocumentDetailsStep } from './income-document-details-step.builders.js';
import type { IncomeRecipientSearchModel } from './income-recipient.service.js';

export const INCOME_CONTEXT_AGGREGATE_KEY = 'income_workspace_context_aggregate' as const;
export const INCOME_WORKSPACE_AGGREGATE_KEY = 'income_workspace_aggregate' as const;

export const INCOME_COMMAND_SELECT_ISSUER = 'select_income_issuer_context' as const;
export const INCOME_COMMAND_CREATE_CUSTOMER = 'create_income_customer' as const;
export const INCOME_COMMAND_CREATE_CUSTOMER_FOR_ISSUER = 'create_income_customer_for_issuer' as const;
export const INCOME_COMMAND_UPDATE_CUSTOMER_FOR_ISSUER = 'update_income_customer_for_issuer' as const;
export const INCOME_COMMAND_CREATE_ONE_TIME_CUSTOMER = 'create_one_time_income_customer' as const;
export const INCOME_COMMAND_CREATE_ITEM = 'create_income_item' as const;
export const INCOME_COMMAND_CREATE_DRAFT = 'create_income_document_draft' as const;
export const INCOME_COMMAND_UPDATE_DRAFT = 'update_income_document_draft' as const;
export const INCOME_COMMAND_CANCEL_DRAFT = 'cancel_income_document_draft' as const;
export const INCOME_COMMAND_ISSUE_DOCUMENT = 'issue_income_document' as const;
export const INCOME_COMMAND_SEARCH_RECIPIENTS = 'search_income_recipients' as const;
export const INCOME_COMMAND_SELECT_RECIPIENT = 'select_income_recipient' as const;
export const INCOME_COMMAND_SET_RECIPIENT_SNAPSHOT = 'set_income_recipient_snapshot' as const;
export const INCOME_COMMAND_SAVE_RECIPIENT_FOR_FUTURE = 'save_income_recipient_for_future' as const;
export const INCOME_COMMAND_RETRY_ACCOUNTING_POSTING = 'retry_income_document_accounting_posting' as const;
export const INCOME_COMMAND_RETRY_PDF_RENDER = 'retry_income_document_pdf_render' as const;
export const INCOME_COMMAND_BEGIN_WIZARD_DRAFT = 'begin_income_wizard_document_draft' as const;
export const INCOME_COMMAND_ADD_LINE = 'add_income_document_line' as const;
export const INCOME_COMMAND_UPDATE_LINE = 'update_income_document_line' as const;
export const INCOME_COMMAND_DELETE_LINE = 'delete_income_document_line' as const;
export const INCOME_COMMAND_REORDER_LINES = 'reorder_income_document_lines' as const;
export const INCOME_COMMAND_UPDATE_DRAFT_SETTINGS = 'update_income_document_draft_settings' as const;
export const INCOME_COMMAND_UPDATE_NOTES = 'update_income_document_notes' as const;
export const INCOME_COMMAND_UPDATE_DELIVERY_CONTACT = 'update_income_document_delivery_contact' as const;
export const INCOME_COMMAND_SAVE_DRAFT = 'save_income_document_draft' as const;
export const INCOME_COMMAND_RESUME_DRAFT = 'resume_income_document_draft' as const;
export const INCOME_COMMAND_GENERATE_PREVIEW = 'generate_income_document_preview' as const;
export const INCOME_COMMAND_UPDATE_DISCOUNT = 'update_income_document_discount' as const;
export {
  INCOME_COMMAND_UPDATE_BRANDING_PROFILE,
  INCOME_COMMAND_UPDATE_BRANDING_PROFILE_PREVIEW_DRAFT,
  INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO,
  INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE,
} from './income-document-branding.types.js';
import {
  INCOME_COMMAND_UPDATE_BRANDING_PROFILE,
  INCOME_COMMAND_UPDATE_BRANDING_PROFILE_PREVIEW_DRAFT,
  INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO,
  INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE,
} from './income-document-branding.types.js';

export type { IncomeDocumentDetailsStep } from './income-document-details-step.builders.js';
export type {
  IncomeDocumentBrandingProfileAggregate,
  IncomeDocumentBrandingSettingsEntrypoint,
  IncomeBrandingPreviewDraftCommandResponse,
  IncomeDocumentBrandingStudioPreviewDraftResult,
} from './income-document-branding.types.js';

export const INCOME_MODULE_CODE = 'income' as const;

export type IncomeActingMode = 'self' | 'office_representative';

export type IncomeDocumentType =
  | 'receipt'
  | 'tax_invoice'
  | 'tax_invoice_receipt'
  | 'credit_tax_invoice'
  | 'deal_invoice'
  | 'quote';

export type IncomeItemType = 'service' | 'product';

export const INCOME_PERMISSIONS = {
  view: 'income.view',
  edit: 'income.edit',
  issue: 'income.issue',
  issueOnBehalf: 'income.issue_on_behalf',
} as const;

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
  | 'more';

export interface IncomeClientDocumentManagementRowAction {
  key: string;
  label: string;
  icon_key: IncomeClientDocumentManagementActionIconKey;
  command: string | null;
  command_payload: Record<string, unknown>;
  enabled: boolean;
  disabled_reason: string | null;
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
}

export const WORK_ENGINE_INVOICES_CLIENT_DOCUMENTS_BY_TYPE_AGGREGATE_KEY =
  'work_engine_invoices_client_documents_by_type_aggregate' as const;

export interface WorkEngineInvoicesClientDocumentsByTypeRow {
  row_id: string;
  document_number: string | null;
  document_type_label: string | null;
  issue_date_display: string | null;
  created_at_display: string | null;
  customer_display_name: string | null;
  amount_display: string;
  status_label: string;
  document_id: string | null;
  draft_id: string | null;
  can_view_document: boolean;
  can_edit_draft: boolean;
  pdf_download_path: string | null;
  allowed_actions: string[];
}

export interface WorkEngineInvoicesClientDocumentsByTypeAggregate {
  aggregate_key: typeof WORK_ENGINE_INVOICES_CLIENT_DOCUMENTS_BY_TYPE_AGGREGATE_KEY;
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

export const INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY =
  'income_client_document_management_panel' as const;

export interface IncomeClientDocumentManagementRow {
  represented_client_id: string;
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
  document_type_counters: IncomeClientDocumentTypeCounter[];
  unpaid_amount_reference: number | null;
  unpaid_amount_display: string;
  last_document_date: string | null;
  last_document_date_display: string;
  last_activity_at: string | null;
  last_activity_display: string;
  status_label: string;
  actions: IncomeClientDocumentManagementRowAction[];
}

export interface IncomeClientDocumentManagementReportItem {
  key: string;
  label: string;
  enabled: boolean;
  disabled_reason: string | null;
}

export interface IncomeClientDocumentManagementPanel {
  aggregate_key: typeof INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY;
  visible: boolean;
  title: string;
  description: string | null;
  columns: Array<{ key: string; label: string }>;
  rows: IncomeClientDocumentManagementRow[];
  report_catalog: IncomeClientDocumentManagementReportItem[];
  empty_state: {
    visible: boolean;
    title: string;
    description: string | null;
  };
}

export const INCOME_CLIENT_INCOME_LEDGER_CARD_AGGREGATE_KEY =
  'income_client_income_ledger_card_aggregate' as const;

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

export interface IncomeClientIncomeLedgerCardMovementRow {
  row_id: string;
  movement_type: 'invoice' | 'payment' | 'credit';
  income_label: string;
  debit_amount_display: string | null;
  credit_amount_display: string | null;
  balance_display: string;
  balance_reference: number;
  balance_tone: 'open' | 'zero' | 'neutral';
  document_number: string;
  issue_date_display: string;
  document_id: string | null;
  can_view_document: boolean;
  allowed_actions: string[];
}

export interface IncomeClientIncomeLedgerCardTopAction {
  key: string;
  label: string;
  icon_key: 'send' | 'print';
  enabled: boolean;
  disabled_reason: string | null;
}

export interface IncomeClientIncomeLedgerCardAggregate {
  aggregate_key: typeof INCOME_CLIENT_INCOME_LEDGER_CARD_AGGREGATE_KEY;
  financial_source: 'TEMPORARY_ACCOUNTING_BASE_PENDING';
  represented_client_id: string;
  represented_client_display_name: string;
  selected_end_customer_id: string | null;
  selected_end_customer_display_name: string | null;
  selected_year: number;
  available_years: number[];
  end_customer_options: IncomeClientIncomeLedgerCardEndCustomerOption[];
  show_customer_picker: boolean;
  summary: {
    total_debit_display: string;
    total_credit_display: string;
    open_balance_display: string;
    invoice_count: number;
    payment_count: number;
    currency: string;
  };
  table_columns: Array<{ key: string; label: string }>;
  rows: IncomeClientIncomeLedgerCardMovementRow[];
  allowed_actions: string[];
  top_actions: IncomeClientIncomeLedgerCardTopAction[];
  empty_state: {
    visible: boolean;
    title: string;
    description: string | null;
  };
  document_download_path_template: string;
}

export interface IncomeWorkspaceContextAggregate {
  aggregate_key: typeof INCOME_CONTEXT_AGGREGATE_KEY;
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
  client_document_management_panel: IncomeClientDocumentManagementPanel;
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
  allowed_actions: string[];
}

export interface IncomeTableModel<T> {
  columns: IncomeTableColumn[];
  rows: T[];
  empty_state: { visible: boolean; title: string; description: string | null };
  editor_fields?: IncomeCustomerEditorField[];
}

export type IncomeDocumentTypeSource = 'country_pack' | 'fallback_il';

export interface IncomeAvailableDocumentType {
  key: IncomeDocumentType;
  label: string;
  enabled: boolean;
  disabled_reason: string | null;
  requires_payment_received: boolean;
  requires_due_date: boolean;
  allows_credit: boolean;
  source: IncomeDocumentTypeSource;
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

export interface IncomeWorkspaceAggregate {
  aggregate_key: typeof INCOME_WORKSPACE_AGGREGATE_KEY;
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
  /** Present while Work Engine income wizard has an active draft on document_details step. */
  document_details_step: IncomeDocumentDetailsStep | null;
  /** Work Engine wizard — backend-owned start step key when resuming. */
  wizard_starting_step_key?: string | null;
  active_wizard_draft_id: string | null;
  document_branding_profile: import('./income-document-branding.types.js').IncomeDocumentBrandingProfileAggregate | null;
  document_branding_settings_entrypoint: import('./income-document-branding.types.js').IncomeDocumentBrandingSettingsEntrypoint | null;
  allowed_actions: string[];
  warnings: IncomeWorkspaceWarning[];
}

export type IncomeCommandType =
  | typeof INCOME_COMMAND_SELECT_ISSUER
  | typeof INCOME_COMMAND_CREATE_CUSTOMER
  | typeof INCOME_COMMAND_CREATE_CUSTOMER_FOR_ISSUER
  | typeof INCOME_COMMAND_UPDATE_CUSTOMER_FOR_ISSUER
  | typeof INCOME_COMMAND_CREATE_ONE_TIME_CUSTOMER
  | typeof INCOME_COMMAND_CREATE_ITEM
  | typeof INCOME_COMMAND_CREATE_DRAFT
  | typeof INCOME_COMMAND_UPDATE_DRAFT
  | typeof INCOME_COMMAND_CANCEL_DRAFT
  | typeof INCOME_COMMAND_ISSUE_DOCUMENT
  | typeof INCOME_COMMAND_SEARCH_RECIPIENTS
  | typeof INCOME_COMMAND_SELECT_RECIPIENT
  | typeof INCOME_COMMAND_SET_RECIPIENT_SNAPSHOT
  | typeof INCOME_COMMAND_SAVE_RECIPIENT_FOR_FUTURE
  | typeof INCOME_COMMAND_RETRY_ACCOUNTING_POSTING
  | typeof INCOME_COMMAND_RETRY_PDF_RENDER
  | typeof INCOME_COMMAND_BEGIN_WIZARD_DRAFT
  | typeof INCOME_COMMAND_ADD_LINE
  | typeof INCOME_COMMAND_UPDATE_LINE
  | typeof INCOME_COMMAND_DELETE_LINE
  | typeof INCOME_COMMAND_REORDER_LINES
  | typeof INCOME_COMMAND_UPDATE_DRAFT_SETTINGS
  | typeof INCOME_COMMAND_UPDATE_NOTES
  | typeof INCOME_COMMAND_UPDATE_DELIVERY_CONTACT
  | typeof INCOME_COMMAND_SAVE_DRAFT
  | typeof INCOME_COMMAND_RESUME_DRAFT
  | typeof INCOME_COMMAND_GENERATE_PREVIEW
  | typeof INCOME_COMMAND_UPDATE_DISCOUNT
  | typeof INCOME_COMMAND_UPDATE_BRANDING_PROFILE
  | typeof INCOME_COMMAND_UPDATE_BRANDING_PROFILE_PREVIEW_DRAFT
  | typeof INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO
  | typeof INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE;

export interface IncomeCommandResponseMeta {
  idempotent_replay?: boolean;
  income_document_id?: string;
  /** `wizard_patch` = lightweight aggregate for Work Engine wizard line/settings edits. */
  workspace_aggregate_mode?: 'full' | 'wizard_patch';
}

export interface IncomeCommandResponse {
  ok: true;
  command: IncomeCommandType;
  income_workspace_aggregate: IncomeWorkspaceAggregate;
  meta?: IncomeCommandResponseMeta;
}

/** INC-1b + INC-2: select issuer returns both refreshed aggregates. */
export interface SelectIncomeIssuerContextCommandResponse {
  ok: true;
  command: typeof INCOME_COMMAND_SELECT_ISSUER;
  income_workspace_context_aggregate: IncomeWorkspaceContextAggregate;
  income_workspace_aggregate: IncomeWorkspaceAggregate;
}
