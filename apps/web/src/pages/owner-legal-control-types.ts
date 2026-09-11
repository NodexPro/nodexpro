/** Use in .tsx files — `Record<…>` is misparsed as JSX in TSX. */
export type UnknownRecord = Record<string, unknown>;
export type StringFieldMap = Record<string, string>;

export type OwnerCommandResponse = {
  ok: true;
  command: string;
  refreshed: {
    aggregate_key: 'owner_legal_control_panel_aggregate' | 'organization_country_settings_aggregate';
    aggregate: UnknownRecord;
  };
};

/** Mirrors backend TaxKnowledgeCommandName — display/action_key only, not a frontend catalog. */
export type TaxKnowledgeCommandName =
  | 'create_tax_source'
  | 'create_tax_rule'
  | 'create_tax_rule_version'
  | 'update_tax_rule_version_draft'
  | 'activate_tax_source'
  | 'retire_tax_source'
  | 'update_tax_source_metadata'
  | 'update_tax_rule_metadata'
  | 'pin_tax_rule_version_source'
  | 'unpin_tax_rule_version_source'
  | 'bind_tax_rule_version_legal_value'
  | 'unbind_tax_rule_version_legal_value'
  | 'create_tax_rule_relationship'
  | 'delete_tax_rule_relationship'
  | 'create_tax_rule_unresolved_legal_reference'
  | 'update_tax_rule_unresolved_legal_reference'
  | 'accept_tax_rule_unresolved_legal_reference'
  | 'discard_tax_rule_unresolved_legal_reference'
  | 'resolve_tax_rule_unresolved_legal_reference'
  | 'activate_tax_rule_version'
  | 'retire_tax_rule_version'
  | 'close_tax_rule_version_effective_to'
  | 'supersede_tax_rule_version';

export type TaxKnowledgeSupersessionPair = {
  new_tax_rule_version_id: string;
  old_tax_rule_version_id: string;
};

export type TaxKnowledgeAllowedAction = {
  action_key: TaxKnowledgeCommandName | string;
  enabled: boolean;
  payload: Record<string, string>;
  candidates?: TaxKnowledgeSupersessionPair[];
};

export type TaxKnowledgeCountry = {
  code: string;
  name: string;
  status: string;
};

export type TaxKnowledgeCitation = {
  id: string;
  tax_rule_version_id: string;
  tax_source_id: string;
  source_code: string;
  title: string;
  provenance_type: string;
  status: string;
  locator: string | null;
  created_at: string;
  allowed_actions: TaxKnowledgeAllowedAction[];
};

export type TaxKnowledgeLegalValueBinding = {
  id: string;
  tax_rule_version_id: string;
  legal_value_id: string;
  value_key: string;
  label: string;
  category: string | null;
  module_scope: string | null;
  status: string;
  created_at: string;
  allowed_actions: TaxKnowledgeAllowedAction[];
};

/** Locked to backend TAX_RULE_RELATIONSHIP_TYPES. Not parsed from payload hints. */
export const TAX_KNOWLEDGE_RELATIONSHIP_TYPES = [
  'depends_on',
  'conflicts_with',
  'exception_to',
  'overrides',
  'alternative_to',
  'special_case_of',
  'elaborates',
  'applies_with',
  'calculation_basis',
  'procedural_requirement',
] as const;

export type TaxKnowledgeRelationship = {
  id: string;
  from_tax_rule_version_id: string;
  to_tax_rule_version_id: string;
  relationship_type: string;
  relationship_type_label?: string;
  activation_critical?: boolean | null;
  activation_critical_label?: string | null;
  status: string;
  owner_note: string | null;
  created_at: string;
  to_tax_rule_id: string;
  to_rule_code: string;
  to_title: string;
  to_version_no: number;
  to_status: string;
  allowed_actions: TaxKnowledgeAllowedAction[];
};

export type TaxKnowledgeUnresolvedResolveCandidate = {
  tax_rule_version_id: string;
  tax_rule_id: string;
  rule_code: string;
  title: string;
  version_no: number;
  status: string;
};

export type TaxKnowledgeUnresolvedLegalReference = {
  id: string;
  from_tax_rule_version_id: string;
  relationship_intent: string;
  relationship_intent_label: string;
  activation_critical: boolean | null;
  activation_critical_label: string | null;
  cited_display: string;
  locator_text: string;
  status: string;
  status_label: string;
  resolve_candidates: TaxKnowledgeUnresolvedResolveCandidate[];
  allowed_actions: TaxKnowledgeAllowedAction[];
};

export type TaxKnowledgeVersion = {
  id: string;
  tax_rule_id: string;
  country_code: string;
  version_no: number;
  status: string;
  country_pack_id: string;
  country_pack_ruleset_id: string;
  effective_from: string;
  effective_to: string | null;
  payload_json: UnknownRecord;
  payload_checksum: string;
  supersedes_version_id: string | null;
  superseded_by_version_id: string | null;
  retired_at: string | null;
  retired_reason: string | null;
  created_at: string;
  sources: TaxKnowledgeCitation[];
  legal_value_bindings: TaxKnowledgeLegalValueBinding[];
  relationships: TaxKnowledgeRelationship[];
  unresolved_legal_references: TaxKnowledgeUnresolvedLegalReference[];
  allowed_actions: TaxKnowledgeAllowedAction[];
};

export type TaxKnowledgeSource = {
  id: string;
  country_code: string;
  source_code: string;
  title: string;
  provenance_type: string;
  issuer: string | null;
  citation_ref: string | null;
  source_url: string | null;
  published_on: string | null;
  status: string;
  owner_note: string | null;
  retired_at: string | null;
  retired_reason: string | null;
  created_at: string;
  updated_at: string;
  allowed_actions: TaxKnowledgeAllowedAction[];
};

export type TaxKnowledgeRule = {
  id: string;
  country_code: string;
  rule_code: string;
  title: string;
  rule_kind: string;
  status: string;
  usage_hint: string | null;
  owner_note: string | null;
  created_at: string;
  updated_at: string;
  versions: TaxKnowledgeVersion[];
  allowed_actions: TaxKnowledgeAllowedAction[];
};

export type OwnerCountryPackRow = {
  id: string;
  country_code: string;
  pack_code: string;
  name: string;
  status: string;
};

export type OwnerRulesetRow = {
  id: string;
  country_pack_id: string;
  ruleset_code: string;
  ruleset_version: string;
  status: string;
};

export type OwnerLegalValueRow = {
  id: string;
  country_code: string;
  value_key: string;
  label: string;
  category: string | null;
  module_scope: string | null;
  status: string;
};

export type TaxKnowledgeAggregate = {
  selected_country_code: string | null;
  countries: TaxKnowledgeCountry[];
  sources: TaxKnowledgeSource[];
  rules: TaxKnowledgeRule[];
  rule_versions: TaxKnowledgeVersion[];
  allowed_actions: TaxKnowledgeAllowedAction[];
  implemented_commands: string[];
  warnings: string[];
};

export function emptyTaxKnowledgeAggregate(): TaxKnowledgeAggregate {
  return {
    selected_country_code: null,
    countries: [],
    sources: [],
    rules: [],
    rule_versions: [],
    allowed_actions: [],
    implemented_commands: [],
    warnings: [],
  };
}

/** Mirrors backend TaxStrategyEngineCommandName — typed on the DTO only. E3C1 does not surface these. */
export const TAX_STRATEGY_ENGINE_COMMANDS = [
  'create_tax_strategy',
  'update_tax_strategy_metadata',
  'create_tax_strategy_exclusive_group',
  'update_tax_strategy_exclusive_group',
  'create_tax_strategy_version',
  'update_tax_strategy_version_draft',
  'activate_tax_strategy_version',
  'retire_tax_strategy_version',
  'close_tax_strategy_version_effective_to',
  'supersede_tax_strategy_version',
  'pin_tax_strategy_rule',
  'unpin_tax_strategy_rule',
  'pin_tax_strategy_calculation',
  'unpin_tax_strategy_calculation',
] as const;

export type TaxStrategyEngineCommandName = (typeof TAX_STRATEGY_ENGINE_COMMANDS)[number];

export type OwnerTaxStrategySupersessionPair = {
  new_tax_strategy_version_id: string;
  old_tax_strategy_version_id: string;
};

export type OwnerTaxStrategyAllowedAction = {
  action_key: TaxStrategyEngineCommandName | string;
  enabled: boolean;
  payload: Record<string, string>;
  candidates?: OwnerTaxStrategySupersessionPair[];
};

export type OwnerTaxStrategyCountry = {
  code: string;
  name: string;
  status: string;
};

export type OwnerTaxStrategyExclusiveGroup = {
  id: string;
  country_code: string;
  group_code: string;
  title: string;
  owner_note: string | null;
  created_at: string;
  updated_at: string;
  allowed_actions: OwnerTaxStrategyAllowedAction[];
};

export type OwnerTaxStrategyRulePin = {
  id: string;
  tax_strategy_version_id: string;
  tax_rule_version_id: string;
  tax_rule_id: string | null;
  rule_code: string | null;
  rule_title: string | null;
  version_no: number | null;
  status: string | null;
  pin_role: string;
  created_at: string;
  allowed_actions: OwnerTaxStrategyAllowedAction[];
};

export type OwnerTaxStrategyCalculationPin = {
  id: string;
  tax_strategy_version_id: string;
  calculation_definition_version_id: string;
  tax_calculation_definition_id: string | null;
  calculation_code: string | null;
  calculation_title: string | null;
  version_no: number | null;
  status: string | null;
  created_at: string;
  allowed_actions: OwnerTaxStrategyAllowedAction[];
};

export type OwnerTaxStrategyCalculationDefinitionVersionCatalogRow = {
  id: string;
  tax_calculation_definition_id: string;
  calculation_code: string;
  title: string;
  version_no: number;
  status: string;
  effective_from?: string;
  effective_to?: string | null;
};

export type OwnerTaxStrategyPinCatalog = {
  calculation_definition_versions: OwnerTaxStrategyCalculationDefinitionVersionCatalogRow[];
};

export type OwnerTaxStrategyVersion = {
  id: string;
  tax_strategy_id: string;
  country_code: string;
  version_no: number;
  status: string;
  effective_from: string;
  effective_to: string | null;
  title: string;
  requires_professional_judgment: boolean;
  exclusive_group_id: string | null;
  exclusive_group_code: string | null;
  exclusive_group_title: string | null;
  authored_metadata_json: UnknownRecord;
  strategy_checksum: string;
  supersedes_version_id: string | null;
  superseded_by_version_id: string | null;
  activated_at: string | null;
  retired_at: string | null;
  retired_reason: string | null;
  created_at: string;
  rule_pins: OwnerTaxStrategyRulePin[];
  calculation_pins: OwnerTaxStrategyCalculationPin[];
  allowed_actions: OwnerTaxStrategyAllowedAction[];
};

export type OwnerTaxStrategy = {
  id: string;
  country_code: string;
  strategy_code: string;
  admin_label: string | null;
  owner_note: string | null;
  created_at: string;
  updated_at: string;
  versions: OwnerTaxStrategyVersion[];
  allowed_actions: OwnerTaxStrategyAllowedAction[];
};

export type OwnerStrategyEngineAggregate = {
  selected_country_code: string | null;
  countries: OwnerTaxStrategyCountry[];
  exclusive_groups: OwnerTaxStrategyExclusiveGroup[];
  strategies: OwnerTaxStrategy[];
  strategy_versions: OwnerTaxStrategyVersion[];
  pin_catalog: OwnerTaxStrategyPinCatalog;
  allowed_actions: OwnerTaxStrategyAllowedAction[];
  warnings: string[];
};

export function emptyStrategyEngineAggregate(): OwnerStrategyEngineAggregate {
  return {
    selected_country_code: null,
    countries: [],
    exclusive_groups: [],
    strategies: [],
    strategy_versions: [],
    pin_catalog: { calculation_definition_versions: [] },
    allowed_actions: [],
    warnings: [],
  };
}

/** Mirrors backend OwnerFactDictionarySlice — display/action_key only. */
export type OwnerFactDictionaryCountry = {
  code: string;
  name: string;
  status: string;
  default_locale?: string | null;
  supported_locales?: string[];
};

export type OwnerFactDictionaryLabeledOption = {
  value: string;
  label: string;
};

export type OwnerTaxFactDictionaryAllowedAction = {
  action_key: string;
  enabled: boolean;
  payload: Record<string, string>;
};

export type OwnerTaxFactEnumOption = {
  id: string;
  tax_fact_definition_version_id: string;
  code: string;
  sort_order: number;
  created_at: string;
  allowed_actions: OwnerTaxFactDictionaryAllowedAction[];
};

export type OwnerTaxFactPresentation = {
  id: string;
  tax_fact_definition_id: string;
  country_code: string | null;
  locale: string;
  label: string;
  professional_question: string;
  client_question: string | null;
  help_text: string | null;
  aliases: string[];
  enum_option_labels: UnknownRecord;
  created_at: string;
  updated_at: string;
  allowed_actions: OwnerTaxFactDictionaryAllowedAction[];
};

export type OwnerTaxFactDefinitionVersion = {
  id: string;
  tax_fact_definition_id: string;
  country_code: string | null;
  version_no: number;
  status: string;
  value_type: string;
  unit_code: string | null;
  currency_policy: UnknownRecord | null;
  validation_json: UnknownRecord;
  definition_checksum: string;
  checksum_matches: boolean;
  effective_from: string;
  effective_to: string | null;
  activated_at: string | null;
  retired_at: string | null;
  retired_reason: string | null;
  created_at: string;
  enum_options: OwnerTaxFactEnumOption[];
  allowed_actions: OwnerTaxFactDictionaryAllowedAction[];
};

export type OwnerTaxFactDefinition = {
  id: string;
  fact_key: string;
  country_code: string | null;
  scope: 'global' | 'country';
  status: string;
  semantic_title: string;
  display_label: string;
  display_locale: string | null;
  owner_note: string | null;
  retired_at: string | null;
  retired_reason: string | null;
  created_at: string;
  updated_at: string;
  versions: OwnerTaxFactDefinitionVersion[];
  presentations: OwnerTaxFactPresentation[];
  allowed_actions: OwnerTaxFactDictionaryAllowedAction[];
};

export type OwnerFactDictionaryAggregate = {
  selected_country_code: string | null;
  selected_scope: 'global' | 'country';
  country_localization: {
    country_code: string | null;
    default_locale: string | null;
    supported_locales: string[];
  };
  countries: OwnerFactDictionaryCountry[];
  definitions: OwnerTaxFactDefinition[];
  definition_versions: OwnerTaxFactDefinitionVersion[];
  enum_options: OwnerTaxFactEnumOption[];
  presentations: OwnerTaxFactPresentation[];
  allowed_actions: OwnerTaxFactDictionaryAllowedAction[];
  implemented_commands: string[];
  value_type_options: OwnerFactDictionaryLabeledOption[];
  warnings: string[];
};

export function emptyFactDictionaryAggregate(): OwnerFactDictionaryAggregate {
  return {
    selected_country_code: null,
    selected_scope: 'global',
    country_localization: { country_code: null, default_locale: null, supported_locales: [] },
    countries: [],
    definitions: [],
    definition_versions: [],
    enum_options: [],
    presentations: [],
    allowed_actions: [],
    implemented_commands: [],
    value_type_options: [],
    warnings: [],
  };
}

/** Same selected country drives both existing Owner Legal Control GET query parameters. */
export function ownerLegalControlCountryQueryParams(countryCode: string): {
  tax_knowledge_country_code: string;
  strategy_engine_country_code: string;
} | null {
  const code = countryCode.trim();
  if (!code) return null;
  return {
    tax_knowledge_country_code: code,
    strategy_engine_country_code: code,
  };
}
