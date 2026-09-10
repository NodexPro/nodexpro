export const TAX_ADVISORY_MODULE_CODE = 'tax-advisory' as const;

export const TAX_ADVISORY_PERMISSIONS = {
  view: 'tax_advisory.view',
  edit: 'tax_advisory.edit',
} as const;

export const TAX_ADVISORY_AGGREGATE_KEY = 'tax_advisory_case_aggregate' as const;

export const TAX_ADVISORY_WORKFLOW_BUSINESS_SETUP = 'business_setup' as const;

export const TAX_ADVISORY_LIFECYCLE_DRAFT = 'draft' as const;
export const TAX_ADVISORY_LIFECYCLE_ARCHIVED = 'archived' as const;

export const TAX_ADVISORY_COMMANDS = [
  'create_tax_advisory_case',
  'set_tax_advisory_case_fact',
  'clear_tax_advisory_case_fact',
  'archive_tax_advisory_case',
] as const;

export type TaxAdvisoryCommandName = (typeof TAX_ADVISORY_COMMANDS)[number];

export function isTaxAdvisoryCommand(command: string): command is TaxAdvisoryCommandName {
  return (TAX_ADVISORY_COMMANDS as readonly string[]).includes(command);
}

export type TaxAdvisoryAllowedAction = {
  action_key: TaxAdvisoryCommandName;
  enabled: boolean;
  reason: string | null;
};

export type TaxAdvisoryClientSummary = {
  id: string;
  display_name: string | null;
  tax_id: string | null;
  country_code: string | null;
  status: string | null;
};

export type TaxAdvisoryCountryContext = {
  legal_engine_country_code: string | null;
  case_country_code: string | null;
  client_country_code: string | null;
  client_country_is_tax_residency: false;
};

export type TaxAdvisoryFactPresentation = {
  locale: string;
  label: string;
  professional_question: string;
  client_question: string | null;
  help_text: string | null;
  enum_option_labels: Record<string, string>;
};

export type TaxAdvisoryFactRow = {
  fact_definition_id: string;
  fact_key: string;
  value_type: string;
  scope: 'global' | 'country';
  country_code: string | null;
  presentation: TaxAdvisoryFactPresentation | null;
  answered: boolean;
  value: unknown | null;
  fact_definition_version_id: string | null;
  current_active_version_id: string | null;
  pinned_version_not_current: boolean;
  enum_codes: string[];
};

export type TaxAdvisoryCaseSlice = {
  id: string;
  organization_id: string;
  client_id: string;
  country_code: string;
  workflow_type: string;
  lifecycle_state: string;
  as_of: string;
  created_by: string;
  created_at: string;
  archived_at: string | null;
  archived_by: string | null;
};

export type TaxAdvisoryEvaluationNotice = {
  code: 'evaluation_not_run';
  message: string;
};

export type TaxAdvisoryCaseAggregate = {
  aggregate_key: typeof TAX_ADVISORY_AGGREGATE_KEY;
  client: TaxAdvisoryClientSummary;
  country: TaxAdvisoryCountryContext;
  current_case: TaxAdvisoryCaseSlice | null;
  as_of: string | null;
  workflow_type: string | null;
  lifecycle_state: string | null;
  allowed_actions: TaxAdvisoryAllowedAction[];
  implemented_commands: readonly TaxAdvisoryCommandName[];
  facts: TaxAdvisoryFactRow[];
  counts: {
    answered: number;
    unanswered_available: number;
  };
  scenarios: [];
  latest_evaluation: null;
  missing_facts_from_engine: null;
  evaluation_notice: TaxAdvisoryEvaluationNotice;
  warnings: string[];
  errors: string[];
};

export type TaxAdvisoryCommandResponse = {
  ok: true;
  command: TaxAdvisoryCommandName;
  refreshed: {
    aggregate_key: typeof TAX_ADVISORY_AGGREGATE_KEY;
    aggregate: TaxAdvisoryCaseAggregate;
  };
};
