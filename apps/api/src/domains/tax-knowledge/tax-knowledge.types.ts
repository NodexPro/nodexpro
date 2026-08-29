export const TAX_KNOWLEDGE_COMMANDS = [
  'create_tax_source',
  'create_tax_rule',
  'create_tax_rule_version',
  'update_tax_rule_version_draft',
  'activate_tax_source',
  'retire_tax_source',
  'update_tax_source_metadata',
  'update_tax_rule_metadata',
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

export const TAX_RULE_KIND = 'legal_rule' as const;

export const TAX_KNOWLEDGE_INITIAL_STATUS = 'draft' as const;

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

export type OwnerTaxKnowledgeAllowedAction = {
  action_key: TaxKnowledgeCommandName;
  enabled: boolean;
  payload: Record<string, string>;
};

export type OwnerTaxKnowledgeCountryDto = {
  code: string;
  name: string;
  status: string;
};

export type OwnerTaxSourceDto = {
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
  allowed_actions: OwnerTaxKnowledgeAllowedAction[];
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
  created_at: string;
  allowed_actions: OwnerTaxKnowledgeAllowedAction[];
};

export type OwnerTaxKnowledgeAggregateOpts = {
  country_code?: string | null;
  countries?: Array<{ code?: string; name?: string; status?: string }>;
};
