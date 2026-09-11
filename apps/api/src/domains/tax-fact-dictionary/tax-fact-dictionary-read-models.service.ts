import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { assertOwnerLegalReadAccess } from '../owner-country-legal-access/owner-country-legal-access.service.js';
import { isSupabaseMissingTableError, isSupabaseMissingColumnError } from '../../shared/supabase-errors.js';
import {
  assembleFactDictionarySlice,
  mapDefinition,
  mapEnumOption,
  mapPresentation,
  mapVersion,
  ownerFactDictionaryIncludesDefinitionCountry,
  type OwnerFactDictionaryCountryDto,
  type OwnerFactDictionarySlice,
  type OwnerTaxFactDefinitionDto,
  type OwnerTaxFactDefinitionVersionDto,
  type OwnerTaxFactEnumOptionDto,
  type OwnerTaxFactPresentationDto,
} from './tax-fact-dictionary-read-models.pure.js';

const DEFINITION_SELECT =
  'id, fact_key, country_code, status, semantic_title, owner_note, retired_at, retired_reason, created_at, updated_at';
const VERSION_SELECT =
  'id, tax_fact_definition_id, country_code, version_no, status, value_type, unit_code, currency_policy, validation_json, definition_checksum, effective_from, effective_to, activated_at, retired_at, retired_reason, created_at';
const ENUM_SELECT = 'id, tax_fact_definition_version_id, code, sort_order, created_at';
const PRESENTATION_SELECT =
  'id, tax_fact_definition_id, country_code, locale, label, professional_question, client_question, help_text, aliases, enum_option_labels, created_at, updated_at';

export type OwnerFactDictionaryAggregateOpts = {
  country_code?: string | null;
  countries?: Array<{
    code?: string;
    name?: string;
    status?: string;
    default_locale?: string | null;
    supported_locales?: string[];
  }>;
};

function normalizeCountryCode(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function mapCountry(row: {
  code?: string;
  name?: string;
  status?: string;
  default_locale?: string | null;
  supported_locales?: string[];
}): OwnerFactDictionaryCountryDto | null {
  if (typeof row.code !== 'string' || !row.code.trim()) return null;
  return {
    code: row.code,
    name: typeof row.name === 'string' ? row.name : row.code,
    status: typeof row.status === 'string' ? row.status : 'active',
    default_locale: typeof row.default_locale === 'string' && row.default_locale.trim() ? row.default_locale : null,
    supported_locales: Array.isArray(row.supported_locales)
      ? row.supported_locales.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

async function loadCountryCatalog(
  provided?: OwnerFactDictionaryAggregateOpts['countries'],
): Promise<OwnerFactDictionaryCountryDto[]> {
  if (provided && provided.length) {
    return provided.map(mapCountry).filter((row): row is OwnerFactDictionaryCountryDto => row !== null);
  }
  const result = await supabaseAdmin
    .from('countries')
    .select('code, name, status, default_locale, supported_locales')
    .order('code');
  if (result.error && isSupabaseMissingColumnError(result.error, 'default_locale')) {
    const fallback = await supabaseAdmin.from('countries').select('code, name, status').order('code');
    if (fallback.error) throw fallback.error;
    return (fallback.data ?? []).map(mapCountry).filter((row): row is OwnerFactDictionaryCountryDto => row !== null);
  }
  if (result.error) throw result.error;
  return (result.data ?? []).map(mapCountry).filter((row): row is OwnerFactDictionaryCountryDto => row !== null);
}

function pushSchemaWarning(warnings: string[]): void {
  if (!warnings.includes('fact_dictionary_schema_not_applied')) {
    warnings.push('fact_dictionary_schema_not_applied');
  }
}

/**
 * Owner Legal Control Fact Dictionary slice.
 * Selected country shows that country's facts plus global facts. Unrelated countries are excluded.
 */
export async function buildOwnerFactDictionaryAggregate(
  ctx: RequestContext,
  opts?: OwnerFactDictionaryAggregateOpts,
): Promise<OwnerFactDictionarySlice> {
  await assertOwnerLegalReadAccess(ctx, opts?.country_code);
  const selectedCountryCode = normalizeCountryCode(opts?.country_code);
  const countries = await loadCountryCatalog(opts?.countries);
  const warnings: string[] = [];

  let definitionQuery = supabaseAdmin
    .from('tax_fact_definitions')
    .select(DEFINITION_SELECT)
    .order('fact_key', { ascending: true });
  if (selectedCountryCode) {
    definitionQuery = definitionQuery.or(`country_code.is.null,country_code.eq.${selectedCountryCode}`);
  } else {
    definitionQuery = definitionQuery.is('country_code', null);
  }

  const definitionResult = await definitionQuery;
  if (definitionResult.error && isSupabaseMissingTableError(definitionResult.error, 'tax_fact_definitions')) {
    pushSchemaWarning(warnings);
    return assembleFactDictionarySlice({
      selected_country_code: selectedCountryCode,
      countries,
      definitions: [],
      warnings,
    });
  }
  if (definitionResult.error) throw definitionResult.error;

  const definitionRows = ((definitionResult.data ?? []) as Record<string, unknown>[]).filter((row) =>
    ownerFactDictionaryIncludesDefinitionCountry(
      typeof row.country_code === 'string' ? row.country_code : null,
      selectedCountryCode,
    ),
  );
  const definitionIds = definitionRows.map((row) => String(row.id));
  if (!definitionIds.length) {
    return assembleFactDictionarySlice({
      selected_country_code: selectedCountryCode,
      countries,
      definitions: [],
      warnings,
    });
  }

  const [versionResult, presentationResult] = await Promise.all([
    supabaseAdmin
      .from('tax_fact_definition_versions')
      .select(VERSION_SELECT)
      .in('tax_fact_definition_id', definitionIds)
      .order('version_no', { ascending: true }),
    supabaseAdmin
      .from('tax_fact_presentations')
      .select(PRESENTATION_SELECT)
      .in('tax_fact_definition_id', definitionIds)
      .order('locale', { ascending: true }),
  ]);

  if (versionResult.error && isSupabaseMissingTableError(versionResult.error, 'tax_fact_definition_versions')) {
    pushSchemaWarning(warnings);
  } else if (versionResult.error) {
    throw versionResult.error;
  }
  if (presentationResult.error && isSupabaseMissingTableError(presentationResult.error, 'tax_fact_presentations')) {
    pushSchemaWarning(warnings);
  } else if (presentationResult.error) {
    throw presentationResult.error;
  }

  const versionRows = (versionResult.data ?? []) as Record<string, unknown>[];
  const versionIds = versionRows.map((row) => String(row.id));
  let enumRows: Record<string, unknown>[] = [];
  if (versionIds.length) {
    const enumResult = await supabaseAdmin
      .from('tax_fact_enum_options')
      .select(ENUM_SELECT)
      .in('tax_fact_definition_version_id', versionIds)
      .order('sort_order', { ascending: true })
      .order('code', { ascending: true });
    if (enumResult.error && isSupabaseMissingTableError(enumResult.error, 'tax_fact_enum_options')) {
      pushSchemaWarning(warnings);
    } else if (enumResult.error) {
      throw enumResult.error;
    } else {
      enumRows = (enumResult.data ?? []) as Record<string, unknown>[];
    }
  }

  const enumsByVersion = new Map<string, OwnerTaxFactEnumOptionDto[]>();
  for (const row of enumRows) {
    const versionId = String(row.tax_fact_definition_version_id);
    const parent = versionRows.find((version) => String(version.id) === versionId);
    const parentDraft = String(parent?.status ?? '') === 'draft';
    const list = enumsByVersion.get(versionId) ?? [];
    list.push(mapEnumOption(row, parentDraft));
    enumsByVersion.set(versionId, list);
  }

  const versionsByDefinition = new Map<string, OwnerTaxFactDefinitionVersionDto[]>();
  for (const row of versionRows) {
    const definitionId = String(row.tax_fact_definition_id);
    const identity = definitionRows.find((definition) => String(definition.id) === definitionId);
    const mapped = mapVersion(
      row,
      {
        fact_key: String(identity?.fact_key ?? ''),
        country_code: typeof identity?.country_code === 'string' ? identity.country_code : null,
        status: String(identity?.status ?? ''),
      },
      enumsByVersion.get(String(row.id)) ?? [],
    );
    if (!mapped.checksum_matches) {
      warnings.push(`fact_dictionary_checksum_mismatch:${mapped.id}`);
    }
    const list = versionsByDefinition.get(definitionId) ?? [];
    list.push(mapped);
    versionsByDefinition.set(definitionId, list);
  }

  const presentationsByDefinition = new Map<string, OwnerTaxFactPresentationDto[]>();
  for (const row of (presentationResult.data ?? []) as Record<string, unknown>[]) {
    const definitionId = String(row.tax_fact_definition_id);
    const list = presentationsByDefinition.get(definitionId) ?? [];
    list.push(mapPresentation(row));
    presentationsByDefinition.set(definitionId, list);
  }

  const selectedCountry = countries.find((row) => row.code === selectedCountryCode) ?? null;
  const defaultLocale = selectedCountry?.default_locale ?? null;

  const definitions: OwnerTaxFactDefinitionDto[] = definitionRows.map((row) =>
    mapDefinition(
      row,
      versionsByDefinition.get(String(row.id)) ?? [],
      presentationsByDefinition.get(String(row.id)) ?? [],
      defaultLocale,
    ),
  );

  return assembleFactDictionarySlice({
    selected_country_code: selectedCountryCode,
    countries,
    definitions,
    warnings,
  });
}
