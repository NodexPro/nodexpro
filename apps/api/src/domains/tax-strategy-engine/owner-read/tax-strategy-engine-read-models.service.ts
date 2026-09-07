import { supabaseAdmin } from '../../../db/client.js';
import type { RequestContext } from '../../../shared/context.js';
import { assertPlatformOwner } from '../../../shared/platform-owner.js';
import { isSupabaseMissingTableError } from '../../../shared/supabase-errors.js';
import {
  assembleStrategyEngineSlice,
  emptyStrategyPinCatalog,
  mapCalculationDefinitionVersionCatalogRow,
  mapCalculationPin,
  mapExclusiveGroup,
  mapRulePin,
  mapStrategyIdentity,
  mapStrategyVersion,
  pairingRowFromVersion,
  type OwnerStrategyEngineSlice,
  type OwnerTaxStrategyCalculationDefinitionVersionCatalogRow,
  type OwnerTaxStrategyCalculationPinDto,
  type OwnerTaxStrategyCountryDto,
  type OwnerTaxStrategyExclusiveGroupDto,
  type OwnerTaxStrategyRulePinDto,
  type OwnerTaxStrategyVersionDto,
} from '../tax-strategy-engine-read-models.pure.js';

const STRATEGY_SELECT =
  'id, country_code, strategy_code, admin_label, owner_note, created_at, updated_at';
const GROUP_SELECT = 'id, country_code, group_code, title, owner_note, created_at, updated_at';
const VERSION_SELECT =
  'id, tax_strategy_id, country_code, version_no, status, effective_from, effective_to, title, requires_professional_judgment, exclusive_group_id, authored_metadata_json, strategy_checksum, supersedes_version_id, superseded_by_version_id, activated_at, retired_at, retired_reason, created_at';
const RULE_PIN_SELECT =
  'id, tax_strategy_version_id, country_code, tax_rule_version_id, pin_role, created_at';
const CALC_PIN_SELECT =
  'id, tax_strategy_version_id, country_code, calculation_definition_version_id, created_at';
const CALC_CATALOG_VERSION_SELECT =
  'id, tax_calculation_definition_id, version_no, status, effective_from, effective_to';
const CALC_CATALOG_DEFINITION_SELECT = 'id, calculation_code, title';

export type OwnerStrategyEngineAggregateOpts = {
  country_code?: string | null;
  countries?: Array<{ code?: string; name?: string; status?: string }>;
};

function normalizeCountryCode(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function mapCountry(row: { code?: string; name?: string; status?: string }): OwnerTaxStrategyCountryDto | null {
  if (typeof row.code !== 'string' || !row.code.trim()) return null;
  return {
    code: row.code,
    name: typeof row.name === 'string' ? row.name : row.code,
    status: typeof row.status === 'string' ? row.status : 'active',
  };
}

async function loadCountryCatalog(
  provided?: OwnerStrategyEngineAggregateOpts['countries'],
): Promise<OwnerTaxStrategyCountryDto[]> {
  if (provided && provided.length) {
    return provided.map(mapCountry).filter((row): row is OwnerTaxStrategyCountryDto => row !== null);
  }
  const { data, error } = await supabaseAdmin.from('countries').select('code, name, status').order('code');
  if (error) throw error;
  return (data ?? []).map(mapCountry).filter((row): row is OwnerTaxStrategyCountryDto => row !== null);
}

function pushSchemaWarning(warnings: string[]): void {
  if (!warnings.includes('strategy_engine_schema_not_applied')) {
    warnings.push('strategy_engine_schema_not_applied');
  }
}

async function loadCalculationDefinitionVersionCatalog(
  countryCode: string,
): Promise<OwnerTaxStrategyCalculationDefinitionVersionCatalogRow[]> {
  const { data: versions, error: versionError } = await supabaseAdmin
    .from('tax_calculation_definition_versions')
    .select(CALC_CATALOG_VERSION_SELECT)
    .eq('country_code', countryCode)
    .order('tax_calculation_definition_id', { ascending: true })
    .order('version_no', { ascending: true });
  if (versionError && isSupabaseMissingTableError(versionError, 'tax_calculation_definition_versions')) {
    return [];
  }
  if (versionError) throw versionError;

  const definitionIds = [
    ...new Set((versions ?? []).map((row) => String((row as { tax_calculation_definition_id: string }).tax_calculation_definition_id))),
  ];
  const definitionById = new Map<string, { calculation_code: string; title: string }>();
  if (definitionIds.length) {
    const { data: definitions, error: definitionError } = await supabaseAdmin
      .from('tax_calculation_definitions')
      .select(CALC_CATALOG_DEFINITION_SELECT)
      .eq('country_code', countryCode)
      .in('id', definitionIds);
    if (definitionError && isSupabaseMissingTableError(definitionError, 'tax_calculation_definitions')) {
      return [];
    }
    if (definitionError) throw definitionError;
    for (const row of definitions ?? []) {
      definitionById.set(String(row.id), {
        calculation_code: String(row.calculation_code),
        title: String(row.title),
      });
    }
  }

  return (versions ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return mapCalculationDefinitionVersionCatalogRow(
      row,
      definitionById.get(String(row.tax_calculation_definition_id)),
    );
  });
}

/**
 * Country-scoped Strategy Engine slice for owner_legal_control_panel_aggregate.
 * Exact-version pins only. No latest-resolution. No evaluation.
 */
export async function buildOwnerStrategyEngineAggregate(
  ctx: RequestContext,
  opts?: OwnerStrategyEngineAggregateOpts,
): Promise<OwnerStrategyEngineSlice> {
  assertPlatformOwner(ctx);

  const countries = await loadCountryCatalog(opts?.countries);
  const selectedCountryCode = normalizeCountryCode(opts?.country_code);
  const warnings: string[] = [];

  if (!selectedCountryCode) {
    return assembleStrategyEngineSlice({
      selectedCountryCode: null,
      countries,
      exclusiveGroups: [],
      strategies: [],
      strategyVersions: [],
      pinCatalog: emptyStrategyPinCatalog(),
      warnings,
    });
  }

  const [strategyResult, groupResult, versionResult, rulePinResult, calcPinResult] = await Promise.all([
    supabaseAdmin
      .from('tax_strategies')
      .select(STRATEGY_SELECT)
      .eq('country_code', selectedCountryCode)
      .order('updated_at', { ascending: false }),
    supabaseAdmin
      .from('tax_strategy_exclusive_groups')
      .select(GROUP_SELECT)
      .eq('country_code', selectedCountryCode)
      .order('group_code', { ascending: true }),
    supabaseAdmin
      .from('tax_strategy_versions')
      .select(VERSION_SELECT)
      .eq('country_code', selectedCountryCode)
      .order('version_no', { ascending: true }),
    supabaseAdmin
      .from('tax_strategy_version_rule_pins')
      .select(RULE_PIN_SELECT)
      .eq('country_code', selectedCountryCode)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('tax_strategy_version_calculation_pins')
      .select(CALC_PIN_SELECT)
      .eq('country_code', selectedCountryCode)
      .order('created_at', { ascending: true }),
  ]);

  for (const result of [strategyResult, groupResult, versionResult, rulePinResult, calcPinResult]) {
    if (result.error && isSupabaseMissingTableError(result.error)) {
      pushSchemaWarning(warnings);
      return assembleStrategyEngineSlice({
        selectedCountryCode,
        countries,
        exclusiveGroups: [],
        strategies: [],
        strategyVersions: [],
        pinCatalog: emptyStrategyPinCatalog(),
        warnings,
      });
    }
    if (result.error) throw result.error;
  }

  const exclusiveGroups = (groupResult.data ?? []).map((row) => mapExclusiveGroup(row as Record<string, unknown>));
  const groupById = new Map(exclusiveGroups.map((group) => [group.id, group]));

  const ruleVersionIds = [
    ...new Set((rulePinResult.data ?? []).map((row) => String((row as { tax_rule_version_id: string }).tax_rule_version_id))),
  ];
  const calcVersionIds = [
    ...new Set(
      (calcPinResult.data ?? []).map((row) =>
        String((row as { calculation_definition_version_id: string }).calculation_definition_version_id),
      ),
    ),
  ];

  const ruleVersionById = new Map<
    string,
    { tax_rule_id: string; version_no: number; status: string }
  >();
  const ruleById = new Map<string, { rule_code: string; title: string }>();
  if (ruleVersionIds.length) {
    const { data: ruleVersions, error: ruleVersionError } = await supabaseAdmin
      .from('tax_rule_versions')
      .select('id, tax_rule_id, version_no, status')
      .eq('country_code', selectedCountryCode)
      .in('id', ruleVersionIds);
    if (ruleVersionError && !isSupabaseMissingTableError(ruleVersionError, 'tax_rule_versions')) {
      throw ruleVersionError;
    }
    for (const row of ruleVersions ?? []) {
      ruleVersionById.set(String(row.id), {
        tax_rule_id: String(row.tax_rule_id),
        version_no: Number(row.version_no),
        status: String(row.status),
      });
    }
    const taxRuleIds = [...new Set([...ruleVersionById.values()].map((row) => row.tax_rule_id))];
    if (taxRuleIds.length) {
      const { data: rules, error: ruleError } = await supabaseAdmin
        .from('tax_rules')
        .select('id, rule_code, title')
        .eq('country_code', selectedCountryCode)
        .in('id', taxRuleIds);
      if (ruleError && !isSupabaseMissingTableError(ruleError, 'tax_rules')) throw ruleError;
      for (const row of rules ?? []) {
        ruleById.set(String(row.id), {
          rule_code: String(row.rule_code),
          title: String(row.title),
        });
      }
    }
  }

  const calcVersionById = new Map<
    string,
    { tax_calculation_definition_id: string; version_no: number; status: string }
  >();
  const calcDefinitionById = new Map<string, { calculation_code: string; title: string }>();
  if (calcVersionIds.length) {
    const { data: calcVersions, error: calcVersionError } = await supabaseAdmin
      .from('tax_calculation_definition_versions')
      .select('id, tax_calculation_definition_id, version_no, status')
      .eq('country_code', selectedCountryCode)
      .in('id', calcVersionIds);
    if (
      calcVersionError
      && !isSupabaseMissingTableError(calcVersionError, 'tax_calculation_definition_versions')
    ) {
      throw calcVersionError;
    }
    for (const row of calcVersions ?? []) {
      calcVersionById.set(String(row.id), {
        tax_calculation_definition_id: String(row.tax_calculation_definition_id),
        version_no: Number(row.version_no),
        status: String(row.status),
      });
    }
    const definitionIds = [...new Set([...calcVersionById.values()].map((row) => row.tax_calculation_definition_id))];
    if (definitionIds.length) {
      const { data: definitions, error: definitionError } = await supabaseAdmin
        .from('tax_calculation_definitions')
        .select('id, calculation_code, title')
        .eq('country_code', selectedCountryCode)
        .in('id', definitionIds);
      if (definitionError && !isSupabaseMissingTableError(definitionError, 'tax_calculation_definitions')) {
        throw definitionError;
      }
      for (const row of definitions ?? []) {
        calcDefinitionById.set(String(row.id), {
          calculation_code: String(row.calculation_code),
          title: String(row.title),
        });
      }
    }
  }

  const versionStatusById = new Map(
    (versionResult.data ?? []).map((row) => [String((row as { id: string }).id), String((row as { status: string }).status)]),
  );
  const siblings = (versionResult.data ?? []).map((row) => pairingRowFromVersion(row as Record<string, unknown>));

  const rulePinsByVersion = new Map<string, OwnerTaxStrategyRulePinDto[]>();
  for (const raw of rulePinResult.data ?? []) {
    const row = raw as Record<string, unknown>;
    const versionId = String(row.tax_strategy_version_id);
    const ruleVersion = ruleVersionById.get(String(row.tax_rule_version_id));
    const rule = ruleVersion ? ruleById.get(ruleVersion.tax_rule_id) : undefined;
    const list = rulePinsByVersion.get(versionId) ?? [];
    list.push(mapRulePin(row, ruleVersion, rule, versionStatusById.get(versionId) === 'draft'));
    rulePinsByVersion.set(versionId, list);
  }

  const calcPinsByVersion = new Map<string, OwnerTaxStrategyCalculationPinDto[]>();
  for (const raw of calcPinResult.data ?? []) {
    const row = raw as Record<string, unknown>;
    const versionId = String(row.tax_strategy_version_id);
    const calcVersion = calcVersionById.get(String(row.calculation_definition_version_id));
    const definition = calcVersion ? calcDefinitionById.get(calcVersion.tax_calculation_definition_id) : undefined;
    const list = calcPinsByVersion.get(versionId) ?? [];
    list.push(mapCalculationPin(row, calcVersion, definition, versionStatusById.get(versionId) === 'draft'));
    calcPinsByVersion.set(versionId, list);
  }

  const strategyVersions: OwnerTaxStrategyVersionDto[] = (versionResult.data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    const id = String(row.id);
    const groupId = row.exclusive_group_id == null ? null : String(row.exclusive_group_id);
    return mapStrategyVersion(
      row,
      groupId ? groupById.get(groupId) : undefined,
      rulePinsByVersion.get(id) ?? [],
      calcPinsByVersion.get(id) ?? [],
      siblings,
    );
  });

  const versionsByStrategy = new Map<string, OwnerTaxStrategyVersionDto[]>();
  for (const version of strategyVersions) {
    const list = versionsByStrategy.get(version.tax_strategy_id) ?? [];
    list.push(version);
    versionsByStrategy.set(version.tax_strategy_id, list);
  }

  const strategies = (strategyResult.data ?? []).map((row) =>
    mapStrategyIdentity(row as Record<string, unknown>, versionsByStrategy.get(String((row as { id: string }).id)) ?? []),
  );

  const calculationDefinitionVersions = await loadCalculationDefinitionVersionCatalog(selectedCountryCode);

  return assembleStrategyEngineSlice({
    selectedCountryCode,
    countries,
    exclusiveGroups,
    strategies,
    strategyVersions,
    pinCatalog: { calculation_definition_versions: calculationDefinitionVersions },
    warnings,
  });
}
