import type {
  OwnerTaxStrategyAllowedAction,
  OwnerTaxStrategySupersessionPair,
  TaxStrategyEngineCommandName,
} from './tax-strategy-engine-commands.types.js';

export type OwnerTaxStrategyCountryDto = {
  code: string;
  name: string;
  status: string;
};

export type OwnerTaxStrategyExclusiveGroupDto = {
  id: string;
  country_code: string;
  group_code: string;
  title: string;
  owner_note: string | null;
  created_at: string;
  updated_at: string;
  allowed_actions: OwnerTaxStrategyAllowedAction[];
};

export type OwnerTaxStrategyRulePinDto = {
  id: string;
  tax_strategy_version_id: string;
  tax_rule_version_id: string;
  tax_rule_id: string | null;
  rule_code: string | null;
  rule_title: string | null;
  version_no: number | null;
  status: string | null;
  pin_role: 'required' | 'prohibited';
  created_at: string;
  allowed_actions: OwnerTaxStrategyAllowedAction[];
};

export type OwnerTaxStrategyCalculationPinDto = {
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
  effective_from: string;
  effective_to: string | null;
};

export type OwnerTaxStrategyPinCatalog = {
  calculation_definition_versions: OwnerTaxStrategyCalculationDefinitionVersionCatalogRow[];
};

export type OwnerTaxStrategyVersionDto = {
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
  authored_metadata_json: Record<string, unknown>;
  strategy_checksum: string;
  supersedes_version_id: string | null;
  superseded_by_version_id: string | null;
  activated_at: string | null;
  retired_at: string | null;
  retired_reason: string | null;
  created_at: string;
  rule_pins: OwnerTaxStrategyRulePinDto[];
  calculation_pins: OwnerTaxStrategyCalculationPinDto[];
  allowed_actions: OwnerTaxStrategyAllowedAction[];
};

export type OwnerTaxStrategyDto = {
  id: string;
  country_code: string;
  strategy_code: string;
  admin_label: string | null;
  owner_note: string | null;
  created_at: string;
  updated_at: string;
  versions: OwnerTaxStrategyVersionDto[];
  allowed_actions: OwnerTaxStrategyAllowedAction[];
};

export type OwnerStrategyEngineSlice = {
  selected_country_code: string | null;
  countries: OwnerTaxStrategyCountryDto[];
  exclusive_groups: OwnerTaxStrategyExclusiveGroupDto[];
  strategies: OwnerTaxStrategyDto[];
  strategy_versions: OwnerTaxStrategyVersionDto[];
  pin_catalog: OwnerTaxStrategyPinCatalog;
  allowed_actions: OwnerTaxStrategyAllowedAction[];
  warnings: string[];
};

export type StrategyVersionPairingRow = {
  id: string;
  tax_strategy_id: string;
  country_code: string;
  status: string;
  supersedes_version_id: string | null;
  effective_from: string;
  effective_to: string | null;
};

function action(
  actionKey: TaxStrategyEngineCommandName,
  enabled: boolean,
  payload: Record<string, string>,
  candidates?: OwnerTaxStrategySupersessionPair[],
): OwnerTaxStrategyAllowedAction {
  return candidates
    ? { action_key: actionKey, enabled, payload, candidates }
    : { action_key: actionKey, enabled, payload };
}

function asOptionalString(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function asAuthoredMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function strategyCatalogAllowedActions(): OwnerTaxStrategyAllowedAction[] {
  return [
    action('create_tax_strategy', true, {
      country_code: 'ISO 3166-1 alpha-2',
      strategy_code: 'string unique per country',
      admin_label: 'optional string',
      owner_note: 'optional string',
    }),
    action('create_tax_strategy_exclusive_group', true, {
      country_code: 'ISO 3166-1 alpha-2',
      group_code: 'string unique per country',
      title: 'string',
      owner_note: 'optional string',
    }),
  ];
}

export function strategyIdentityAllowedActions(): OwnerTaxStrategyAllowedAction[] {
  return [
    action('update_tax_strategy_metadata', true, {
      tax_strategy_id: 'uuid',
      admin_label: 'optional string',
      owner_note: 'optional string',
    }),
    action('create_tax_strategy_version', true, {
      tax_strategy_id: 'uuid',
      title: 'string',
      effective_from: 'YYYY-MM-DD',
      effective_to: 'optional YYYY-MM-DD',
      requires_professional_judgment: 'boolean',
      exclusive_group_id: 'optional uuid',
      authored_metadata_json: 'canonical JSON object',
    }),
  ];
}

export function exclusiveGroupAllowedActions(): OwnerTaxStrategyAllowedAction[] {
  return [
    action('update_tax_strategy_exclusive_group', true, {
      tax_strategy_exclusive_group_id: 'uuid',
      title: 'optional string',
      owner_note: 'optional string',
    }),
  ];
}

export function lineageCompatible(neu: StrategyVersionPairingRow, old: StrategyVersionPairingRow): boolean {
  return neu.supersedes_version_id == null || neu.supersedes_version_id === old.id;
}

export function eligibleStrategySupersessionPairs(
  version: StrategyVersionPairingRow,
  siblings: StrategyVersionPairingRow[],
): OwnerTaxStrategySupersessionPair[] {
  const pairs: OwnerTaxStrategySupersessionPair[] = [];
  for (const other of siblings) {
    if (other.id === version.id) continue;
    if (other.tax_strategy_id !== version.tax_strategy_id) continue;
    if (other.country_code !== version.country_code) continue;
    if (version.status === 'draft' && other.status === 'active' && lineageCompatible(version, other)) {
      pairs.push({
        new_tax_strategy_version_id: version.id,
        old_tax_strategy_version_id: other.id,
      });
    } else if (version.status === 'active' && other.status === 'draft' && lineageCompatible(other, version)) {
      pairs.push({
        new_tax_strategy_version_id: other.id,
        old_tax_strategy_version_id: version.id,
      });
    }
  }
  pairs.sort((a, b) => {
    const byNew = a.new_tax_strategy_version_id.localeCompare(b.new_tax_strategy_version_id);
    return byNew !== 0 ? byNew : a.old_tax_strategy_version_id.localeCompare(b.old_tax_strategy_version_id);
  });
  return pairs;
}

export function canCloseStrategyEffectiveTo(version: StrategyVersionPairingRow): boolean {
  if (version.status !== 'active') return false;
  if (!version.effective_from) return false;
  if (version.effective_to == null || version.effective_to === '') return true;
  return version.effective_to > version.effective_from;
}

export function strategyVersionAllowedActions(
  version: StrategyVersionPairingRow,
  siblings: StrategyVersionPairingRow[],
): OwnerTaxStrategyAllowedAction[] {
  if (version.status === 'retired') return [];

  const draft = version.status === 'draft';
  const active = version.status === 'active';
  const candidates = eligibleStrategySupersessionPairs(version, siblings);
  const supersedePayload =
    candidates.length === 1
      ? {
          new_tax_strategy_version_id: candidates[0].new_tax_strategy_version_id,
          old_tax_strategy_version_id: candidates[0].old_tax_strategy_version_id,
        }
      : {
          new_tax_strategy_version_id: '',
          old_tax_strategy_version_id: '',
        };

  const actions: OwnerTaxStrategyAllowedAction[] = [];
  if (draft) {
    actions.push(
      action('update_tax_strategy_version_draft', true, {
        tax_strategy_version_id: 'uuid',
        title: 'optional string',
        effective_from: 'optional YYYY-MM-DD',
        effective_to: 'optional YYYY-MM-DD',
        requires_professional_judgment: 'optional boolean',
        exclusive_group_id: 'optional uuid or null',
        authored_metadata_json: 'optional canonical JSON object',
      }),
      action('pin_tax_strategy_rule', true, {
        tax_strategy_version_id: 'uuid',
        tax_rule_version_id: 'uuid',
        pin_role: 'required|prohibited',
      }),
      action('pin_tax_strategy_calculation', true, {
        tax_strategy_version_id: 'uuid',
        calculation_definition_version_id: 'uuid',
      }),
      action('activate_tax_strategy_version', true, {
        tax_strategy_version_id: 'uuid',
      }),
      action('retire_tax_strategy_version', true, {
        tax_strategy_version_id: 'uuid',
        retired_reason: 'optional string',
      }),
    );
  }
  if (active) {
    if (canCloseStrategyEffectiveTo(version)) {
      actions.push(
        action('close_tax_strategy_version_effective_to', true, {
          tax_strategy_version_id: 'uuid',
          effective_to: 'YYYY-MM-DD',
        }),
      );
    }
    actions.push(
      action('retire_tax_strategy_version', true, {
        tax_strategy_version_id: 'uuid',
        retired_reason: 'optional string',
      }),
    );
  }
  if (candidates.length > 0) {
    actions.push(action('supersede_tax_strategy_version', true, supersedePayload, candidates));
  }
  return actions;
}

export function rulePinAllowedActions(parentDraft: boolean): OwnerTaxStrategyAllowedAction[] {
  if (!parentDraft) return [];
  return [
    action('unpin_tax_strategy_rule', true, {
      tax_strategy_version_rule_pin_id: 'uuid',
    }),
  ];
}

export function calculationPinAllowedActions(parentDraft: boolean): OwnerTaxStrategyAllowedAction[] {
  if (!parentDraft) return [];
  return [
    action('unpin_tax_strategy_calculation', true, {
      tax_strategy_version_calculation_pin_id: 'uuid',
    }),
  ];
}

export function mapExclusiveGroup(row: Record<string, unknown>): OwnerTaxStrategyExclusiveGroupDto {
  return {
    id: String(row.id),
    country_code: String(row.country_code),
    group_code: String(row.group_code),
    title: String(row.title),
    owner_note: asOptionalString(row.owner_note),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    allowed_actions: exclusiveGroupAllowedActions(),
  };
}

export function mapRulePin(
  row: Record<string, unknown>,
  ruleVersion: {
    tax_rule_id?: string;
    version_no?: number;
    status?: string;
  } | undefined,
  rule: { rule_code?: string; title?: string } | undefined,
  parentDraft: boolean,
): OwnerTaxStrategyRulePinDto {
  const pinRole = String(row.pin_role) === 'prohibited' ? 'prohibited' : 'required';
  return {
    id: String(row.id),
    tax_strategy_version_id: String(row.tax_strategy_version_id),
    tax_rule_version_id: String(row.tax_rule_version_id),
    tax_rule_id: ruleVersion?.tax_rule_id == null ? null : String(ruleVersion.tax_rule_id),
    rule_code: rule?.rule_code == null ? null : String(rule.rule_code),
    rule_title: rule?.title == null ? null : String(rule.title),
    version_no: ruleVersion?.version_no == null ? null : Number(ruleVersion.version_no),
    status: ruleVersion?.status == null ? null : String(ruleVersion.status),
    pin_role: pinRole,
    created_at: String(row.created_at),
    allowed_actions: rulePinAllowedActions(parentDraft),
  };
}

export function emptyStrategyPinCatalog(): OwnerTaxStrategyPinCatalog {
  return { calculation_definition_versions: [] };
}

export function mapCalculationDefinitionVersionCatalogRow(
  version: Record<string, unknown>,
  definition: { calculation_code?: string; title?: string } | undefined,
): OwnerTaxStrategyCalculationDefinitionVersionCatalogRow {
  return {
    id: String(version.id),
    tax_calculation_definition_id: String(version.tax_calculation_definition_id),
    calculation_code: definition?.calculation_code == null ? '' : String(definition.calculation_code),
    title: definition?.title == null ? '' : String(definition.title),
    version_no: Number(version.version_no),
    status: String(version.status),
    effective_from: String(version.effective_from ?? ''),
    effective_to: asOptionalString(version.effective_to),
  };
}

export function mapCalculationPin(
  row: Record<string, unknown>,
  calcVersion: {
    tax_calculation_definition_id?: string;
    version_no?: number;
    status?: string;
  } | undefined,
  definition: { calculation_code?: string; title?: string } | undefined,
  parentDraft: boolean,
): OwnerTaxStrategyCalculationPinDto {
  return {
    id: String(row.id),
    tax_strategy_version_id: String(row.tax_strategy_version_id),
    calculation_definition_version_id: String(row.calculation_definition_version_id),
    tax_calculation_definition_id:
      calcVersion?.tax_calculation_definition_id == null
        ? null
        : String(calcVersion.tax_calculation_definition_id),
    calculation_code: definition?.calculation_code == null ? null : String(definition.calculation_code),
    calculation_title: definition?.title == null ? null : String(definition.title),
    version_no: calcVersion?.version_no == null ? null : Number(calcVersion.version_no),
    status: calcVersion?.status == null ? null : String(calcVersion.status),
    created_at: String(row.created_at),
    allowed_actions: calculationPinAllowedActions(parentDraft),
  };
}

export function mapStrategyVersion(
  row: Record<string, unknown>,
  exclusiveGroup: OwnerTaxStrategyExclusiveGroupDto | undefined,
  rulePins: OwnerTaxStrategyRulePinDto[],
  calculationPins: OwnerTaxStrategyCalculationPinDto[],
  siblings: StrategyVersionPairingRow[],
): OwnerTaxStrategyVersionDto {
  const pairing: StrategyVersionPairingRow = {
    id: String(row.id),
    tax_strategy_id: String(row.tax_strategy_id),
    country_code: String(row.country_code),
    status: String(row.status),
    supersedes_version_id: asOptionalString(row.supersedes_version_id),
    effective_from: String(row.effective_from),
    effective_to: asOptionalString(row.effective_to),
  };
  return {
    id: pairing.id,
    tax_strategy_id: pairing.tax_strategy_id,
    country_code: pairing.country_code,
    version_no: Number(row.version_no),
    status: pairing.status,
    effective_from: String(row.effective_from),
    effective_to: asOptionalString(row.effective_to),
    title: String(row.title),
    requires_professional_judgment: row.requires_professional_judgment === true,
    exclusive_group_id: asOptionalString(row.exclusive_group_id),
    exclusive_group_code: exclusiveGroup?.group_code ?? null,
    exclusive_group_title: exclusiveGroup?.title ?? null,
    authored_metadata_json: asAuthoredMetadata(row.authored_metadata_json),
    strategy_checksum: String(row.strategy_checksum),
    supersedes_version_id: pairing.supersedes_version_id,
    superseded_by_version_id: asOptionalString(row.superseded_by_version_id),
    activated_at: asOptionalString(row.activated_at),
    retired_at: asOptionalString(row.retired_at),
    retired_reason: asOptionalString(row.retired_reason),
    created_at: String(row.created_at),
    rule_pins: rulePins,
    calculation_pins: calculationPins,
    allowed_actions: strategyVersionAllowedActions(pairing, siblings),
  };
}

export function mapStrategyIdentity(
  row: Record<string, unknown>,
  versions: OwnerTaxStrategyVersionDto[],
): OwnerTaxStrategyDto {
  return {
    id: String(row.id),
    country_code: String(row.country_code),
    strategy_code: String(row.strategy_code),
    admin_label: asOptionalString(row.admin_label),
    owner_note: asOptionalString(row.owner_note),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    versions,
    allowed_actions: strategyIdentityAllowedActions(),
  };
}

export function assembleStrategyEngineSlice(input: {
  selectedCountryCode: string | null;
  countries: OwnerTaxStrategyCountryDto[];
  exclusiveGroups: OwnerTaxStrategyExclusiveGroupDto[];
  strategies: OwnerTaxStrategyDto[];
  strategyVersions: OwnerTaxStrategyVersionDto[];
  pinCatalog?: OwnerTaxStrategyPinCatalog;
  warnings: string[];
}): OwnerStrategyEngineSlice {
  return {
    selected_country_code: input.selectedCountryCode,
    countries: input.countries,
    exclusive_groups: input.exclusiveGroups,
    strategies: input.strategies,
    strategy_versions: input.strategyVersions,
    pin_catalog: input.pinCatalog ?? emptyStrategyPinCatalog(),
    allowed_actions: strategyCatalogAllowedActions(),
    warnings: input.warnings,
  };
}

export function pairingRowFromVersion(row: Record<string, unknown>): StrategyVersionPairingRow {
  return {
    id: String(row.id),
    tax_strategy_id: String(row.tax_strategy_id),
    country_code: String(row.country_code),
    status: String(row.status),
    supersedes_version_id: asOptionalString(row.supersedes_version_id),
    effective_from: String(row.effective_from ?? ''),
    effective_to: asOptionalString(row.effective_to),
  };
}
