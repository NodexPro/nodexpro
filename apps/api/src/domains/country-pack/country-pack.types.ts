export type CountryStatus = 'active' | 'disabled';
export type CountryPackStatus = 'draft' | 'enabled' | 'disabled';
export type CountryPackRulesetStatus = 'draft' | 'active' | 'deprecated' | 'disabled';
export type OrganizationCountrySettingsStatus = 'not_configured' | 'active' | 'disabled' | 'error';
export type CapabilityStatus = 'enabled' | 'disabled';
export type LegalValueStatus = 'draft' | 'active' | 'disabled';
export type LegalValueVersionStatus = 'draft' | 'active' | 'deprecated' | 'disabled';
export type LegalValueType = 'number' | 'percentage' | 'boolean' | 'string' | 'json' | 'money' | 'date';

export type Country = {
  code: string;
  name: string;
  status: CountryStatus;
  default_timezone: string | null;
  created_at: string;
};

export type CountryPack = {
  id: string;
  country_code: string;
  pack_code: string;
  name: string;
  status: CountryPackStatus;
  module_code: string | null;
  framework_version: string;
  code_version: string;
  created_at: string;
  updated_at: string;
};

export type CountryPackRuleset = {
  id: string;
  country_pack_id: string;
  ruleset_code: string;
  ruleset_version: string;
  legal_basis_reference: string | null;
  effective_from: string;
  effective_to: string | null;
  status: CountryPackRulesetStatus;
  checksum: string | null;
  created_at: string;
  updated_at: string;
};

export type OrganizationCountrySettings = {
  id: string;
  organization_id: string;
  country_code: string;
  active_country_pack_id: string | null;
  active_ruleset_id: string | null;
  settings_status: OrganizationCountrySettingsStatus;
  created_at: string;
  updated_at: string;
};

export type CountryExtensionCapability = {
  id: string;
  country_pack_id: string;
  capability_code: string;
  status: CapabilityStatus;
  created_at: string;
};

export type LegalValue = {
  id: string;
  country_code: string;
  value_key: string;
  label: string;
  category: string;
  module_scope: string;
  usage_hint: string | null;
  owner_note: string | null;
  value_type: LegalValueType;
  status: LegalValueStatus;
  created_at: string;
  updated_at: string;
};

export type LegalValueVersion = {
  id: string;
  legal_value_id: string;
  country_pack_ruleset_id: string;
  value_payload_json: unknown;
  effective_from: string;
  effective_to: string | null;
  status: LegalValueVersionStatus;
  created_at: string;
  updated_at: string;
};

export type ResolvedCountryContext = {
  country_code: string;
  country_pack_id: string | null;
  ruleset_id: string | null;
  resolved_values_map: Record<string, unknown>;
  warnings: string[];
};

