/**
 * INV-3A/3B/3C — accounts_receivable_aggregate contract (Accounting Base financial truth).
 */

export const ACCOUNTS_RECEIVABLE_AGGREGATE_KEY = 'accounts_receivable_aggregate' as const;

export type AccountsReceivablePaymentStateFilter = 'unpaid' | 'partial' | 'all_open';
export type AccountsReceivableOverdueFilter = 'true' | 'false' | 'all';
export type AccountsReceivableAgingBucketKey =
  | 'current'
  | '1_30'
  | '31_60'
  | '61_90'
  | '90_plus';
export type AccountsReceivableAgingBucketFilter = AccountsReceivableAgingBucketKey | 'all';

export type AccountsReceivableCurrencyTotal = {
  currency: string;
  open_invoice_count: number;
  original_amount: number;
  paid_amount: number;
  remaining_balance: number;
};

export type AccountsReceivableAgingCurrencyTotal = {
  currency: string;
  remaining_balance: number;
};

export type AccountsReceivableAgingBucketSummary = {
  bucket_key: AccountsReceivableAgingBucketKey;
  label: string;
  label_he: string;
  invoice_count: number;
  totals_by_currency: AccountsReceivableAgingCurrencyTotal[];
};

export type AccountsReceivableClientCurrencyTotal = {
  currency: string;
  original_amount: number;
  paid_amount: number;
  remaining_balance: number;
  overdue_remaining_balance: number;
};

/** Client outstanding: office groups by represented_client_id; self mode uses client_id null. */
export type AccountsReceivableClientOutstanding = {
  client_id: string | null;
  client_display_name: string | null;
  open_invoice_count: number;
  unpaid_count: number;
  partial_count: number;
  overdue_count: number;
  totals_by_currency: AccountsReceivableClientCurrencyTotal[];
  aging: {
    buckets: AccountsReceivableAgingBucketSummary[];
  };
};

export type AccountsReceivableRow = {
  income_document_id: string;
  document_number: string;
  document_type: string;
  issue_date: string | null;
  due_date: string | null;
  customer: {
    id: string | null;
    display_name: string | null;
  };
  currency: string;
  original_amount: number;
  paid_amount: number;
  remaining_balance: number;
  payment_state_key: 'unpaid' | 'partial' | 'paid';
  financial_source: 'accounting_base';
  due_state_key: 'not_applicable' | 'not_due' | 'overdue';
  overdue: boolean;
  overdue_since: string | null;
  days_overdue: number | null;
  aging_bucket_key: AccountsReceivableAgingBucketKey;
  aging_label: string;
  aging_label_he: string;
  allowed_actions: Array<{
    action_key: string;
    label: string;
    enabled: boolean;
    command: string | null;
    reason: string | null;
    source_module: 'income' | 'accounting_base';
  }>;
};

export type AccountsReceivableAggregate = {
  aggregate_key: typeof ACCOUNTS_RECEIVABLE_AGGREGATE_KEY;
  scope: {
    organization_id: string;
    acting_mode: string;
    issuer_business_id: string;
    represented_client_id: string | null;
  };
  summary: {
    open_invoice_count: number;
    unpaid_count: number;
    partial_count: number;
    overdue_count: number;
    totals_by_currency: AccountsReceivableCurrencyTotal[];
  };
  aging: {
    buckets: AccountsReceivableAgingBucketSummary[];
  };
  clients: AccountsReceivableClientOutstanding[];
  rows: AccountsReceivableRow[];
  filters: {
    payment_state: AccountsReceivablePaymentStateFilter;
    overdue: AccountsReceivableOverdueFilter;
    aging_bucket: AccountsReceivableAgingBucketFilter;
    currency: string | null;
    due_date_from: string | null;
    due_date_to: string | null;
    issue_date_from: string | null;
    issue_date_to: string | null;
  };
  pagination: {
    limit: number;
    offset: number;
    total_count: number;
    has_more: boolean;
  };
  meta: {
    generated_at: string;
    financial_source: 'accounting_base';
    document_type_scope: string[];
    /** False when candidate load hit AR_CANDIDATE_MAX — clients/summary may be incomplete. */
    clients_totals_complete: boolean;
    notes: string[];
  };
};
