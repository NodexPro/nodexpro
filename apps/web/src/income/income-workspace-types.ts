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

export interface IncomeCustomersTableRow {
  customer_id: string;
  display_name: string;
  phone: string | null;
  email: string | null;
  tax_id: string | null;
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
  allowed_actions: string[];
  warnings: IncomeWorkspaceWarning[];
}

export type IncomeCommandType =
  | 'select_income_issuer_context'
  | 'create_income_customer'
  | 'create_one_time_income_customer'
  | 'create_income_item'
  | 'create_income_document_draft'
  | 'update_income_document_draft'
  | 'cancel_income_document_draft'
  | 'issue_income_document'
  | 'retry_income_document_accounting_posting'
  | 'retry_income_document_pdf_render';

export interface IncomeCommandResponse {
  ok: true;
  command: IncomeCommandType;
  income_workspace_aggregate: IncomeWorkspaceAggregate;
}

export interface SelectIncomeIssuerContextCommandResponse {
  ok: true;
  command: 'select_income_issuer_context';
  income_workspace_context_aggregate: IncomeWorkspaceContextAggregate;
  income_workspace_aggregate: IncomeWorkspaceAggregate;
}
