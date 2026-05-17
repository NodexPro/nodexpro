export const INCOME_AGGREGATE_KEY = 'income_workspace_context_aggregate' as const;

export const INCOME_COMMAND_SELECT_ISSUER = 'select_income_issuer_context' as const;

export const INCOME_MODULE_CODE = 'income' as const;

export type IncomeActingMode = 'self' | 'office_representative';

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
  aggregate_key: typeof INCOME_AGGREGATE_KEY;
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

export interface SelectIncomeIssuerContextPayload {
  command: typeof INCOME_COMMAND_SELECT_ISSUER;
  acting_mode: IncomeActingMode;
  represented_client_id: string | null;
  issuer_business_id: string;
}

export interface SelectIncomeIssuerContextCommandResponse {
  ok: true;
  command: typeof INCOME_COMMAND_SELECT_ISSUER;
  income_workspace_context_aggregate: IncomeWorkspaceContextAggregate;
}
