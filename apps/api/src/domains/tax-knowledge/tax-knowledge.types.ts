export const TAX_KNOWLEDGE_COMMANDS = [
  'create_tax_source',
  'create_tax_rule',
  'create_tax_rule_version',
  'update_tax_rule_version_draft',
  'activate_tax_source',
  'retire_tax_source',
  'update_tax_source_metadata',
  'update_tax_rule_metadata',
  'pin_tax_rule_version_source',
  'unpin_tax_rule_version_source',
  'bind_tax_rule_version_legal_value',
  'unbind_tax_rule_version_legal_value',
  'create_tax_rule_relationship',
  'delete_tax_rule_relationship',
  'create_tax_rule_unresolved_legal_reference',
  'update_tax_rule_unresolved_legal_reference',
  'accept_tax_rule_unresolved_legal_reference',
  'discard_tax_rule_unresolved_legal_reference',
  'resolve_tax_rule_unresolved_legal_reference',
  'activate_tax_rule_version',
  'retire_tax_rule_version',
  'close_tax_rule_version_effective_to',
  'supersede_tax_rule_version',
  'create_tax_domain',
  'update_tax_domain_metadata',
  'create_tax_legal_node_kind',
  'create_tax_legal_node',
  'update_tax_legal_node_metadata',
  'link_tax_rule_legal_node',
  'unlink_tax_rule_legal_node',
] as const;

export type TaxKnowledgeCommandName = (typeof TAX_KNOWLEDGE_COMMANDS)[number];

export const TAX_SOURCE_PROVENANCE_TYPES = [
  'official_law',
  'regulation',
  'circular',
  'official_guidance',
  'case_law_citation',
  'textbook',
  'professional_material',
  'other',
] as const;

export type TaxSourceProvenanceType = (typeof TAX_SOURCE_PROVENANCE_TYPES)[number];

export const TAX_SOURCE_PROVENANCE_TYPE_LABELS: Record<TaxSourceProvenanceType, string> = {
  official_law: 'Law',
  regulation: 'Regulation',
  circular: 'Circular',
  official_guidance: 'Official Guidance',
  case_law_citation: 'Court Decision',
  textbook: 'Textbook',
  professional_material: 'Professional material',
  other: 'Other',
};

export const TAX_RULE_KIND = 'legal_rule' as const;

export const TAX_RULE_RELATIONSHIP_TYPES = [
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

export type TaxRuleRelationshipType = (typeof TAX_RULE_RELATIONSHIP_TYPES)[number];

export const TAX_KNOWLEDGE_INITIAL_STATUS = 'draft' as const;

/** Stable API error codes for Tax Knowledge publication/lifecycle failures. */
export const TAX_KNOWLEDGE_ERROR_CODES = {
  ACTIVE_SOURCE_REQUIRED: 'TAX_KNOWLEDGE_ACTIVE_SOURCE_REQUIRED',
  RELATIONSHIP_TARGET_NOT_ACTIVE: 'TAX_KNOWLEDGE_RELATIONSHIP_TARGET_NOT_ACTIVE',
  ACTIVE_WINDOW_OVERLAP: 'TAX_KNOWLEDGE_ACTIVE_WINDOW_OVERLAP',
  INVALID_LIFECYCLE_TRANSITION: 'TAX_KNOWLEDGE_INVALID_LIFECYCLE_TRANSITION',
  EFFECTIVE_TO_INVALID: 'TAX_KNOWLEDGE_EFFECTIVE_TO_INVALID',
  INVALID_PREDICATE: 'TAX_KNOWLEDGE_INVALID_PREDICATE',
  UNRESOLVED_REFERENCE_BLOCKS_ACTIVATION: 'TAX_KNOWLEDGE_UNRESOLVED_REFERENCE_BLOCKS_ACTIVATION',
} as const;

export const TAX_RULE_CITED_INSTRUMENT_KINDS = [
  'law',
  'section',
  'regulation',
  'instruction',
  'order',
  'other',
] as const;

export type TaxRuleCitedInstrumentKind = (typeof TAX_RULE_CITED_INSTRUMENT_KINDS)[number];

export const TAX_RULE_UNRESOLVED_STATUSES = ['draft', 'open', 'resolved', 'discarded'] as const;

export type TaxRuleUnresolvedStatus = (typeof TAX_RULE_UNRESOLVED_STATUSES)[number];

export const TAX_RULE_RELATIONSHIP_TYPE_LABELS: Record<TaxRuleRelationshipType, string> = {
  depends_on: 'Depends on',
  conflicts_with: 'Conflicts with',
  exception_to: 'Exception to',
  overrides: 'Overrides',
  alternative_to: 'Alternative to',
  special_case_of: 'Special case of',
  elaborates: 'Elaborates',
  applies_with: 'Applies with',
  calculation_basis: 'Calculation basis',
  procedural_requirement: 'Procedural requirement',
};

export const TAX_RULE_CITED_INSTRUMENT_KIND_LABELS: Record<TaxRuleCitedInstrumentKind, string> = {
  law: 'Law',
  section: 'Section',
  regulation: 'Regulation',
  instruction: 'Instruction',
  order: 'Order',
  other: 'Other',
};

export const TAX_RULE_UNRESOLVED_STATUS_LABELS: Record<TaxRuleUnresolvedStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  resolved: 'Resolved',
  discarded: 'Discarded',
};

export type TaxKnowledgeErrorCode =
  (typeof TAX_KNOWLEDGE_ERROR_CODES)[keyof typeof TAX_KNOWLEDGE_ERROR_CODES];

export function isTaxKnowledgeCommand(command: string): command is TaxKnowledgeCommandName {
  return (TAX_KNOWLEDGE_COMMANDS as readonly string[]).includes(command);
}

export type TaxKnowledgeCommandResponse = {
  ok: true;
  command: TaxKnowledgeCommandName;
  refreshed: {
    aggregate_key: 'owner_legal_control_panel_aggregate';
    aggregate: Record<string, unknown>;
  };
};

export type OwnerTaxKnowledgeSupersessionPair = {
  new_tax_rule_version_id: string;
  old_tax_rule_version_id: string;
};

export type OwnerTaxKnowledgeAllowedAction = {
  action_key: TaxKnowledgeCommandName;
  enabled: boolean;
  payload: Record<string, string>;
  /** Backend-owned executable pairs. Present only on supersede_tax_rule_version. */
  candidates?: OwnerTaxKnowledgeSupersessionPair[];
};

export type OwnerTaxKnowledgeCountryDto = {
  code: string;
  name: string;
  status: string;
};

export type OwnerTaxSourceDto = {
  id: string;
  country_code: string;
  tax_domain_id: string | null;
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
  allowed_actions: OwnerTaxKnowledgeAllowedAction[];
};

export type OwnerLegalLibraryAllowedAction = OwnerTaxKnowledgeAllowedAction;

export type OwnerLegalLibraryLinkedRuleDto = {
  link_id: string;
  tax_rule_id: string;
  tax_legal_node_id: string;
  title: string;
  rule_code: string;
  status: string;
  version_count: number;
  allowed_actions: OwnerTaxKnowledgeAllowedAction[];
};

export type OwnerLegalLibraryNodeDto = {
  id: string;
  tax_source_id: string;
  parent_node_id: string | null;
  tax_legal_node_kind_id: string;
  kind_label: string;
  node_code: string;
  node_number: string | null;
  title: string;
  display_title: string;
  sort_order: number;
  status: string;
  owner_note: string | null;
  created_at: string;
  updated_at: string;
  linked_rules: OwnerLegalLibraryLinkedRuleDto[];
  children: OwnerLegalLibraryNodeDto[];
  allowed_actions: OwnerTaxKnowledgeAllowedAction[];
};

export type OwnerLegalLibrarySourceDto = {
  id: string;
  tax_domain_id: string | null;
  title: string;
  provenance_type: string;
  provenance_type_label: string;
  status: string;
  issuer: string | null;
  source_code: string;
  nodes: OwnerLegalLibraryNodeDto[];
  allowed_actions: OwnerTaxKnowledgeAllowedAction[];
};

export type OwnerLegalLibraryDomainDto = {
  id: string;
  domain_code: string;
  title: string;
  status: string;
  owner_note: string | null;
  sort_order: number;
  sources: OwnerLegalLibrarySourceDto[];
  allowed_actions: OwnerTaxKnowledgeAllowedAction[];
};

export type OwnerLegalLibraryNodeKindDto = {
  id: string;
  country_code: string;
  kind_code: string;
  label: string;
  status: string;
  owner_note: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  allowed_actions: OwnerTaxKnowledgeAllowedAction[];
};

export type OwnerLegalLibraryUnassignedRuleDto = {
  id: string;
  title: string;
  rule_code: string;
  status: string;
  version_count: number;
  allowed_actions: OwnerTaxKnowledgeAllowedAction[];
};

export type OwnerLegalLibrarySliceDto = {
  schema_applied: boolean;
  domains: OwnerLegalLibraryDomainDto[];
  unassigned_sources: OwnerLegalLibrarySourceDto[];
  unassigned_rules: OwnerLegalLibraryUnassignedRuleDto[];
  node_kinds: OwnerLegalLibraryNodeKindDto[];
  provenance_type_options: OwnerTaxKnowledgeLabeledOption[];
  allowed_actions: OwnerTaxKnowledgeAllowedAction[];
  trainer_upload: { available: false; status_label: 'Coming later' };
};

export type OwnerTaxRuleDto = {
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
  versions: OwnerTaxRuleVersionDto[];
  allowed_actions: OwnerTaxKnowledgeAllowedAction[];
};

export type OwnerTaxRuleVersionSourceDto = {
  id: string;
  tax_rule_version_id: string;
  tax_source_id: string;
  source_code: string;
  title: string;
  provenance_type: string;
  status: string;
  locator: string | null;
  created_at: string;
  allowed_actions: OwnerTaxKnowledgeAllowedAction[];
};

export type OwnerTaxRuleVersionLegalValueDto = {
  id: string;
  tax_rule_version_id: string;
  legal_value_id: string;
  value_key: string;
  label: string;
  category: string | null;
  module_scope: string | null;
  status: string;
  created_at: string;
  allowed_actions: OwnerTaxKnowledgeAllowedAction[];
};

export type OwnerTaxRuleRelationshipDto = {
  id: string;
  from_tax_rule_version_id: string;
  to_tax_rule_version_id: string;
  relationship_type: string;
  relationship_type_label: string;
  activation_critical: boolean | null;
  activation_critical_label: string | null;
  status: string;
  owner_note: string | null;
  created_at: string;
  to_tax_rule_id: string;
  to_rule_code: string;
  to_title: string;
  to_version_no: number;
  to_status: string;
  allowed_actions: OwnerTaxKnowledgeAllowedAction[];
};

export type OwnerTaxRuleUnresolvedResolveCandidate = {
  tax_rule_version_id: string;
  tax_rule_id: string;
  rule_code: string;
  title: string;
  version_no: number;
  status: string;
};

export type OwnerTaxRuleUnresolvedLegalReferenceDto = {
  id: string;
  from_tax_rule_version_id: string;
  relationship_intent: string;
  relationship_intent_label: string;
  activation_critical: boolean | null;
  activation_critical_label: string | null;
  cited_title: string | null;
  cited_law_name: string | null;
  cited_instrument_kind: string;
  cited_instrument_kind_label: string;
  cited_provision_number: string | null;
  locator_text: string;
  cited_display: string;
  source_tax_source_id: string | null;
  source_locator: string | null;
  status: string;
  status_label: string;
  resolved_to_tax_rule_version_id: string | null;
  resolved_relationship_id: string | null;
  owner_note: string | null;
  created_at: string;
  resolved_at: string | null;
  discarded_at: string | null;
  discarded_reason: string | null;
  resolve_candidates: OwnerTaxRuleUnresolvedResolveCandidate[];
  allowed_actions: OwnerTaxKnowledgeAllowedAction[];
};

export type OwnerTaxKnowledgeLabeledOption = {
  value: string;
  label: string;
};

export type OwnerTaxRuleVersionDto = {
  id: string;
  tax_rule_id: string;
  country_code: string;
  version_no: number;
  status: string;
  country_pack_id: string;
  country_pack_ruleset_id: string;
  effective_from: string;
  effective_to: string | null;
  payload_json: Record<string, unknown>;
  payload_checksum: string;
  supersedes_version_id: string | null;
  superseded_by_version_id: string | null;
  retired_at: string | null;
  retired_reason: string | null;
  created_at: string;
  sources: OwnerTaxRuleVersionSourceDto[];
  legal_value_bindings: OwnerTaxRuleVersionLegalValueDto[];
  relationships: OwnerTaxRuleRelationshipDto[];
  unresolved_legal_references: OwnerTaxRuleUnresolvedLegalReferenceDto[];
  allowed_actions: OwnerTaxKnowledgeAllowedAction[];
};

export type OwnerTaxKnowledgeAggregateOpts = {
  country_code?: string | null;
  countries?: Array<{ code?: string; name?: string; status?: string }>;
};
