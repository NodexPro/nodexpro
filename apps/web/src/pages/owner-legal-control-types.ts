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
