export type AccountingPeriodStatus = 'open' | 'locked' | 'closed';
export type AccountingEntryPostingState = 'draft' | 'finalized';
export type AccountingEntryStatus = 'active' | 'archived';
export type AccountingDirection = 'debit' | 'credit';

export type AccountingPeriodRow = {
  id: string;
  organization_id: string;
  period_start: string;
  period_end: string;
  period_label: string;
  status: AccountingPeriodStatus;
  base_currency: string;
  closed_at: string | null;
  closed_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AccountingCategoryRow = {
  id: string;
  organization_id: string | null;
  parent_category_id: string | null;
  code: string;
  name: string;
  category_type: string;
  status: 'active' | 'inactive';
  is_system: boolean;
  created_at: string;
  updated_at: string;
};

export type AccountingEntryRow = {
  id: string;
  organization_id: string;
  period_id: string;
  category_id: string;
  client_id: string | null;
  entry_type: string;
  status: AccountingEntryStatus;
  posting_state: AccountingEntryPostingState;
  description: string | null;
  entry_date: string;
  amount: number;
  currency: string;
  direction: AccountingDirection;
  source_type: string | null;
  created_by: string;
  finalized_at: string | null;
  finalized_by: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

export type AccountingEntryLinkRow = {
  id: string;
  organization_id: string;
  accounting_entry_id: string;
  target_entity_type: string;
  target_entity_id: string;
  relation_type: string;
  created_by: string;
  created_at: string;
};

export type AccountingSummaryRow = {
  id: string;
  organization_id: string;
  period_id: string;
  summary_scope: string;
  summary_key: string;
  amount_total: number;
  currency: string;
  calculated_at: string;
  created_at: string;
  updated_at: string;
};
