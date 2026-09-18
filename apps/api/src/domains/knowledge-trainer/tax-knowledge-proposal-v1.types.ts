import { TAX_RULE_CITED_INSTRUMENT_KINDS, TAX_RULE_RELATIONSHIP_TYPES } from '../tax-knowledge/tax-knowledge.types.js';
import { TAX_CALCULATION_VALUE_TYPES } from '../tax-calculation-engine/tax-calculation-engine.types.js';

export const TAX_KNOWLEDGE_PROPOSAL_CONTRACT = 'tax_knowledge_proposal_v1' as const;
export const TAX_KNOWLEDGE_PROPOSAL_SCHEMA_VERSION = 1 as const;
/** Matches TAX-639 `LOCAL_KEY_RE`. Provider schema and extract normalizer must use this grammar. */
export const TAX_KNOWLEDGE_PROPOSAL_LOCAL_KEY_PATTERN = '^[A-Za-z][A-Za-z0-9_-]{0,63}$';

export const TAX_KNOWLEDGE_PROPOSAL_TOP_LEVEL_KEYS = [
  'schema_version',
  'contract',
  'extraction_outcome',
  'legal_nodes',
  'rules',
  'relationships',
  'calculations',
  'facts',
  'legal_values',
  'evidence',
  'uncertainties',
] as const;

export const TAX_KNOWLEDGE_PROPOSAL_NODE_KEYS = [
  'proposal_node_key',
  'existing_tax_legal_node_id',
  'source_display_identifier',
  'tax_legal_node_kind_id',
  'kind_label',
  'parent',
  'title',
  'node_number',
  'printed_marker',
] as const;

export const TAX_KNOWLEDGE_PROPOSAL_RULE_KEYS = [
  'proposal_rule_key',
  'title',
  'rule_kind',
  'existing_tax_rule_id',
  'usage_hint',
  'owner_note',
  'statement',
  'applies_if',
  'does_not_apply_if',
  'applicability_status',
  'notes',
  'effective_from',
  'effective_to',
  'legal_node_keys',
  'existing_tax_legal_node_ids',
  'legal_value_keys',
  'calculation_keys',
] as const;

export const TAX_KNOWLEDGE_PROPOSAL_RELATIONSHIP_KEYS = [
  'from',
  'to',
  'relationship_type',
  'activation_critical',
  'unresolved',
] as const;

export const TAX_KNOWLEDGE_PROPOSAL_ENDPOINT_KEYS = ['kind', 'key', 'tax_rule_version_id'] as const;

export const TAX_KNOWLEDGE_PROPOSAL_UNRESOLVED_KEYS = [
  'cited_instrument_kind',
  'locator_text',
  'cited_title',
  'cited_law_name',
  'cited_provision_number',
  'source_tax_source_id',
  'source_locator',
] as const;

export const TAX_KNOWLEDGE_PROPOSAL_CALC_KEYS = [
  'proposal_calc_key',
  'required',
  'title',
  'pin_rule_keys',
  'input_fact_keys',
  'legal_value_keys',
  'output_type',
  'expression',
] as const;

export const TAX_KNOWLEDGE_PROPOSAL_FACT_KEYS = [
  'fact_key',
  'role',
  'dictionary_status',
  'existing_tax_fact_definition_id',
] as const;

export const TAX_KNOWLEDGE_PROPOSAL_LEGAL_VALUE_KEYS = ['value_key', 'existing_legal_value_id'] as const;

export const TAX_KNOWLEDGE_PROPOSAL_EVIDENCE_KEYS = ['source_role', 'quotes', 'citations', 'legal_locator'] as const;
export const TAX_KNOWLEDGE_PROPOSAL_QUOTE_KEYS = ['role', 'text', 'start', 'end'] as const;
export const TAX_KNOWLEDGE_PROPOSAL_CITATION_KEYS = ['tax_source_id', 'locator'] as const;
export const TAX_KNOWLEDGE_PROPOSAL_LOCATOR_KEYS = [
  'source_display_identifier',
  'normalized_machine_identifier',
] as const;
export const TAX_KNOWLEDGE_PROPOSAL_UNCERTAINTY_KEYS = ['code', 'severity', 'subject', 'message', 'detail'] as const;
export const TAX_KNOWLEDGE_PROPOSAL_SUBJECT_KEYS = ['kind', 'key'] as const;
export const TAX_KNOWLEDGE_PROPOSAL_PARENT_KEYS = ['kind', 'key', 'tax_legal_node_id'] as const;

export const TAX_KNOWLEDGE_PROPOSAL_PARENT_KINDS = ['proposal_node', 'existing'] as const;
export const TAX_KNOWLEDGE_PROPOSAL_RELATIONSHIP_ENDPOINT_KINDS = [
  'proposal_rule',
  'existing_rule_version',
] as const;
export const TAX_KNOWLEDGE_PROPOSAL_UNRESOLVED_ENDPOINT_KIND = 'unresolved' as const;
export const TAX_KNOWLEDGE_PROPOSAL_UNCERTAINTY_SUBJECT_KINDS = [
  'proposal',
  'rule',
  'node',
  'calculation',
  'fact',
  'legal_value',
  'relationship',
] as const;
export const TAX_KNOWLEDGE_PROPOSAL_EVIDENCE_SOURCE_ROLE = 'reviewed_owner_draft' as const;

export const TAX_KNOWLEDGE_PROPOSAL_EXTRACTION_OUTCOMES = ['rules', 'no_rules', 'cannot_determine'] as const;
export type TaxKnowledgeProposalExtractionOutcome =
  (typeof TAX_KNOWLEDGE_PROPOSAL_EXTRACTION_OUTCOMES)[number];

export const TAX_KNOWLEDGE_PROPOSAL_APPLICABILITY_STATUSES = [
  'determined',
  'unconstrained',
  'cannot_determine',
] as const;
export type TaxKnowledgeProposalApplicabilityStatus =
  (typeof TAX_KNOWLEDGE_PROPOSAL_APPLICABILITY_STATUSES)[number];

export const TAX_KNOWLEDGE_PROPOSAL_FACT_ROLES = [
  'applicability_condition',
  'required_missing',
  'informational',
  'calculation_input',
] as const;
export type TaxKnowledgeProposalFactRole = (typeof TAX_KNOWLEDGE_PROPOSAL_FACT_ROLES)[number];

export const TAX_KNOWLEDGE_PROPOSAL_FACT_DICTIONARY_STATUSES = [
  'bound_existing',
  'missing_definition',
  'reserved_forbidden',
] as const;
export type TaxKnowledgeProposalFactDictionaryStatus =
  (typeof TAX_KNOWLEDGE_PROPOSAL_FACT_DICTIONARY_STATUSES)[number];

export const TAX_KNOWLEDGE_PROPOSAL_UNCERTAINTY_CODES = [
  'unresolved_reference',
  'missing_fact_definition',
  'ambiguous_interpretation',
  'professional_judgment_required',
  'insufficient_evidence',
  'cannot_determine',
] as const;
export type TaxKnowledgeProposalUncertaintyCode =
  (typeof TAX_KNOWLEDGE_PROPOSAL_UNCERTAINTY_CODES)[number];

export const TAX_KNOWLEDGE_PROPOSAL_UNCERTAINTY_SEVERITIES = [
  'blocks_rule_publication',
  'blocks_activation_only',
  'review_only',
] as const;
export type TaxKnowledgeProposalUncertaintySeverity =
  (typeof TAX_KNOWLEDGE_PROPOSAL_UNCERTAINTY_SEVERITIES)[number];

export const TAX_KNOWLEDGE_PROPOSAL_EVIDENCE_QUOTE_ROLES = ['verbatim_from_draft', 'ai_paraphrase'] as const;
export type TaxKnowledgeProposalEvidenceQuoteRole =
  (typeof TAX_KNOWLEDGE_PROPOSAL_EVIDENCE_QUOTE_ROLES)[number];

export const TAX_KNOWLEDGE_PROPOSAL_RELATIONSHIP_TYPES = TAX_RULE_RELATIONSHIP_TYPES;
export const TAX_KNOWLEDGE_PROPOSAL_CITED_INSTRUMENT_KINDS = TAX_RULE_CITED_INSTRUMENT_KINDS;
export const TAX_KNOWLEDGE_PROPOSAL_CALC_OUTPUT_TYPES = TAX_CALCULATION_VALUE_TYPES;

export const TAX_KNOWLEDGE_PROPOSAL_FORBIDDEN_IDENTITY_KEYS = ['node_code', 'rule_code', 'calculation_code'] as const;

export const TAX_KNOWLEDGE_PROPOSAL_STATUTORY_LITERAL_KEYS = [
  'legal_value_version_id',
  'value_payload_json',
  'statutory_rate',
  'statutory_amount',
  'statutory_ceiling',
  'copied_amount',
  'copied_rate',
  'copied_percentage',
  'amount',
  'rate',
  'ceiling',
  'threshold',
] as const;

export type TaxKnowledgeProposalIssue = {
  path: string;
  code: string;
  message: string;
};

export type TaxKnowledgeProposalUncertainty = {
  code: TaxKnowledgeProposalUncertaintyCode;
  severity: TaxKnowledgeProposalUncertaintySeverity;
  subject: {
    kind: 'proposal' | 'rule' | 'node' | 'calculation' | 'fact' | 'legal_value' | 'relationship';
    key: string | null;
  } | null;
  message: string;
  detail: string | null;
};

export type TaxKnowledgeProposalResolvedFactBinding = {
  fact_key: string;
  role: TaxKnowledgeProposalFactRole;
  dictionary_status: TaxKnowledgeProposalFactDictionaryStatus;
  tax_fact_definition_id: string | null;
  country_code: string | null;
  value_type: string | null;
  k3_type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | null;
};

export type TaxKnowledgeProposalResolvedLegalValue = {
  value_key: string;
  legal_value_id: string;
  country_code: string;
};

export type TaxKnowledgeProposalResolvedExistingRuleRef = {
  path: string;
  tax_rule_id: string | null;
  tax_rule_version_id: string | null;
  country_code: string;
};

export type TaxKnowledgeProposalEvidenceValidation = {
  draft_legal_text_length: number;
  verbatim_quote_count: number;
  paraphrase_quote_count: number;
  citation_count: number;
  authoritative_evidence: boolean;
  quotes: Array<{
    index: number;
    role: TaxKnowledgeProposalEvidenceQuoteRole;
    matched: boolean;
    message: string | null;
  }>;
};

export type TaxKnowledgeProposalV1ValidationResult = {
  valid_schema: boolean;
  publication_eligible: boolean;
  owner_approval_allowed: boolean;
  errors: TaxKnowledgeProposalIssue[];
  warnings: TaxKnowledgeProposalIssue[];
  blocking_uncertainties: TaxKnowledgeProposalUncertainty[];
  resolved_fact_bindings: TaxKnowledgeProposalResolvedFactBinding[];
  resolved_legal_values: TaxKnowledgeProposalResolvedLegalValue[];
  resolved_existing_rule_refs: TaxKnowledgeProposalResolvedExistingRuleRef[];
  evidence_validation: TaxKnowledgeProposalEvidenceValidation;
};

export type TaxKnowledgeProposalV1ValidationSummary = {
  valid_schema: boolean;
  publication_eligible: boolean;
  owner_approval_allowed: boolean;
  error_count: number;
  warning_count: number;
  blocking_uncertainty_count: number;
  errors: TaxKnowledgeProposalIssue[];
  warnings: TaxKnowledgeProposalIssue[];
  blocking_uncertainties: TaxKnowledgeProposalUncertainty[];
  resolved_fact_bindings: TaxKnowledgeProposalResolvedFactBinding[];
  resolved_legal_values: TaxKnowledgeProposalResolvedLegalValue[];
  resolved_existing_rule_refs: TaxKnowledgeProposalResolvedExistingRuleRef[];
  evidence_validation: TaxKnowledgeProposalEvidenceValidation;
};

export type TaxKnowledgeProposalCatalogFact = {
  id: string;
  fact_key: string;
  country_code: string | null;
  status: string;
  value_type: string | null;
  enum_codes: string[];
};

export type TaxKnowledgeProposalCatalogLegalValue = {
  id: string;
  value_key: string;
  country_code: string;
  status: string;
};

export type TaxKnowledgeProposalCatalogNode = {
  id: string;
  country_code: string;
  tax_source_id: string;
};

export type TaxKnowledgeProposalCatalogKind = {
  id: string;
  country_code: string;
};

export type TaxKnowledgeProposalCatalogRule = {
  id: string;
  country_code: string;
};

export type TaxKnowledgeProposalCatalogRuleVersion = {
  id: string;
  country_code: string;
  tax_rule_id: string;
};

export type TaxKnowledgeProposalCatalogSource = {
  id: string;
  country_code: string;
};

export type TaxKnowledgeProposalValidationCatalog = {
  legal_nodes: TaxKnowledgeProposalCatalogNode[];
  legal_node_kinds: TaxKnowledgeProposalCatalogKind[];
  tax_rules: TaxKnowledgeProposalCatalogRule[];
  tax_rule_versions: TaxKnowledgeProposalCatalogRuleVersion[];
  tax_sources: TaxKnowledgeProposalCatalogSource[];
  facts: TaxKnowledgeProposalCatalogFact[];
  legal_values: TaxKnowledgeProposalCatalogLegalValue[];
};

export type TaxKnowledgeProposalValidationContext = {
  country_code: string;
  tax_source_id: string;
  legal_text_draft_id: string;
  draft_legal_text: string;
};
