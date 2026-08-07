/**
 * INV-2A — invoice_lifecycle_aggregate contract (composed dimensions only; no ribbon).
 */

export const INVOICE_LIFECYCLE_AGGREGATE_KEY = 'invoice_lifecycle_aggregate' as const;

export type InvoiceLifecycleDocumentStateKey = 'draft' | 'issued';
export type InvoiceLifecycleDeliveryStateKey = 'not_sent' | 'sent' | 'failed';
export type InvoiceLifecyclePaymentStateKey = 'unpaid' | 'partial' | 'paid';
export type InvoiceLifecycleDueStateKey = 'not_applicable' | 'not_due' | 'overdue';
export type InvoiceLifecycleFinalizationStateKey = 'open';

export type InvoiceLifecycleAllowedAction = {
  action_key: string;
  label: string;
  enabled: boolean;
  command: string | null;
  reason: string | null;
  source_module: 'income' | 'delivery' | 'accounting_base' | 'work_engine';
};

export type InvoiceLifecycleChannelSummary = {
  attempt_count: number;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
};

export type InvoiceLifecycleAggregate = {
  aggregate_key: typeof INVOICE_LIFECYCLE_AGGREGATE_KEY;
  income_document_id: string;
  organization_id: string;
  represented_client_id: string | null;

  document: {
    document_type: string;
    document_number: string;
    document_state_key: InvoiceLifecycleDocumentStateKey;
    issue_date: string | null;
    due_date: string | null;
    source_draft_id: string | null;
  };

  delivery: {
    state_key: InvoiceLifecycleDeliveryStateKey;
    attempt_count: number;
    last_attempt_at: string | null;
    last_success_at: string | null;
    last_failure_at: string | null;
    channels: {
      email: InvoiceLifecycleChannelSummary;
      docflow: InvoiceLifecycleChannelSummary;
    };
  };

  payment: {
    original_amount: number;
    paid_amount: number;
    remaining_balance: number;
    state_key: InvoiceLifecyclePaymentStateKey;
    last_payment_at: string | null;
    financial_source: 'accounting_base';
  };

  due: {
    state_key: InvoiceLifecycleDueStateKey;
    overdue: boolean;
    overdue_since: string | null;
    days_overdue: number | null;
  };

  collection: {
    active: boolean;
    work_item_id: string | null;
    work_state: string | null;
    next_actions: Array<{
      command: string;
      enabled: boolean;
      reason: string | null;
      source_module: 'work_engine';
    }>;
  };

  finalization: {
    state_key: InvoiceLifecycleFinalizationStateKey;
  };

  allowed_actions: InvoiceLifecycleAllowedAction[];

  meta: {
    generated_at: string;
    composers: Array<'income' | 'delivery' | 'accounting_base' | 'work_engine'>;
  };
};
