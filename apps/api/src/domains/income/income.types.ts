export const INCOME_CONTEXT_AGGREGATE_KEY = 'income_workspace_context_aggregate' as const;
export const INCOME_WORKSPACE_AGGREGATE_KEY = 'income_workspace_aggregate' as const;

export const INCOME_COMMAND_SELECT_ISSUER = 'select_income_issuer_context' as const;
export const INCOME_COMMAND_CREATE_CUSTOMER = 'create_income_customer' as const;
export const INCOME_COMMAND_CREATE_ONE_TIME_CUSTOMER = 'create_one_time_income_customer' as const;
export const INCOME_COMMAND_CREATE_ITEM = 'create_income_item' as const;
export const INCOME_COMMAND_CREATE_DRAFT = 'create_income_document_draft' as const;
export const INCOME_COMMAND_UPDATE_DRAFT = 'update_income_document_draft' as const;
export const INCOME_COMMAND_CANCEL_DRAFT = 'cancel_income_document_draft' as const;

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

export interface IncomeTableModel<T> {
  columns: IncomeTableColumn[];
  rows: T[];
  empty_state: { visible: boolean; title: string; description: string | null };
}

export interface IncomeWorkspaceAggregate {
  aggregate_key: typeof INCOME_WORKSPACE_AGGREGATE_KEY;
  org_id: string;
  actor_user_id: string;
  issuer_context: IncomeIssuerContextSummary;
  cards: IncomeWorkspaceCard[];
  customers_table_model: IncomeTableModel<IncomeCustomersTableRow>;
  items_table_model: IncomeTableModel<IncomeItemsTableRow>;
  drafts_table_model: IncomeTableModel<IncomeDraftsTableRow>;
  allowed_actions: string[];
}

export type IncomeCommandType =
  | typeof INCOME_COMMAND_SELECT_ISSUER
  | typeof INCOME_COMMAND_CREATE_CUSTOMER
  | typeof INCOME_COMMAND_CREATE_ONE_TIME_CUSTOMER
  | typeof INCOME_COMMAND_CREATE_ITEM
  | typeof INCOME_COMMAND_CREATE_DRAFT
  | typeof INCOME_COMMAND_UPDATE_DRAFT
  | typeof INCOME_COMMAND_CANCEL_DRAFT;

export interface IncomeCommandResponse {
  ok: true;
  command: IncomeCommandType;
  income_workspace_aggregate: IncomeWorkspaceAggregate;
}

/** INC-1b + INC-2: select issuer returns both refreshed aggregates. */
export interface SelectIncomeIssuerContextCommandResponse {
  ok: true;
  command: typeof INCOME_COMMAND_SELECT_ISSUER;
  income_workspace_context_aggregate: IncomeWorkspaceContextAggregate;
  income_workspace_aggregate: IncomeWorkspaceAggregate;
}
