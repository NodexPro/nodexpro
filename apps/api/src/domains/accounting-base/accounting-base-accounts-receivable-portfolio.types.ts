/**
 * INV-3D — accounts_receivable_portfolio_aggregate contract (office-level AB truth).
 */

import type {
  AccountsReceivableAgingBucketFilter,
  AccountsReceivableAgingBucketKey,
  AccountsReceivableAgingBucketSummary,
  AccountsReceivableClientOutstanding,
  AccountsReceivableOverdueFilter,
  AccountsReceivablePaymentStateFilter,
} from './accounting-base-accounts-receivable.types.js';

export const ACCOUNTS_RECEIVABLE_PORTFOLIO_AGGREGATE_KEY =
  'accounts_receivable_portfolio_aggregate' as const;

export const ACCOUNTING_BASE_AR_PORTFOLIO_GRAIN_RPC =
  'accounting_base_accounts_receivable_portfolio_grain' as const;
export const ACCOUNTING_BASE_AR_PORTFOLIO_ROWS_RPC =
  'accounting_base_accounts_receivable_portfolio_rows' as const;

export type AccountsReceivablePortfolioCurrencyTotal = {
  currency: string;
  open_invoice_count: number;
  original_amount: number;
  paid_amount: number;
  remaining_balance: number;
  overdue_remaining_balance: number;
};

export type AccountsReceivablePortfolioGrain = {
  represented_client_id: string;
  currency: string;
  aging_bucket_key: AccountsReceivableAgingBucketKey;
  payment_state_key: 'unpaid' | 'partial';
  overdue: boolean;
  invoice_count: number;
  original_amount: number;
  paid_amount: number;
  remaining_balance: number;
  overdue_remaining_balance: number;
};

export type AccountsReceivablePortfolioRow = {
  income_document_id: string;
  represented_client_id: string;
  client_display_name: string | null;
  document_number: string;
  document_type: string;
  issue_date: string | null;
  due_date: string | null;
  currency: string;
  original_amount: number;
  paid_amount: number;
  remaining_balance: number;
  payment_state_key: 'unpaid' | 'partial';
  financial_source: 'accounting_base';
  due_state_key: 'not_applicable' | 'not_due' | 'overdue';
  overdue: boolean;
  overdue_since: string | null;
  days_overdue: number | null;
  aging_bucket_key: AccountsReceivableAgingBucketKey;
  aging_label: string;
  aging_label_he: string;
};

export type AccountsReceivablePortfolioAggregate = {
  aggregate_key: typeof ACCOUNTS_RECEIVABLE_PORTFOLIO_AGGREGATE_KEY;
  scope: {
    organization_id: string;
    scope_kind: 'office_portfolio';
  };
  summary: {
    open_invoice_count: number;
    unpaid_count: number;
    partial_count: number;
    overdue_count: number;
    totals_by_currency: AccountsReceivablePortfolioCurrencyTotal[];
  };
  aging: {
    buckets: AccountsReceivableAgingBucketSummary[];
  };
  clients: AccountsReceivableClientOutstanding[];
  rows: AccountsReceivablePortfolioRow[];
  filters: {
    represented_client_id: string | null;
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
    clients_totals_complete: true;
    notes: string[];
  };
};
