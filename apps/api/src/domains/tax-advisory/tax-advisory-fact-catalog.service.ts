import { supabaseAdmin } from '../../db/client.js';
import { isSupabaseMissingTableError } from '../../shared/supabase-errors.js';
import {
  ownerFactDictionaryIncludesDefinitionCountry,
} from '../tax-fact-dictionary/tax-fact-dictionary-read-models.pure.js';
import { assertCurrencyPolicy } from '../tax-fact-dictionary/tax-fact-dictionary-validation.pure.js';
import type { TaxFactValueType } from '../tax-fact-dictionary/tax-fact-dictionary.types.js';
import { normalizeIsoCountry } from './tax-advisory-country.pure.js';

const DEFINITION_SELECT =
  'id, fact_key, country_code, status, semantic_title, created_at, updated_at';
const VERSION_SELECT =
  'id, tax_fact_definition_id, country_code, version_no, status, value_type, unit_code, currency_policy, validation_json, effective_from, effective_to, activated_at, retired_at';
const ENUM_SELECT = 'id, tax_fact_definition_version_id, code, sort_order';
const PRESENTATION_SELECT =
  'id, tax_fact_definition_id, country_code, locale, label, professional_question, client_question, help_text, aliases, enum_option_labels';

export type TenantFactPresentation = {
  locale: string;
  country_code: string | null;
  label: string;
  professional_question: string;
  client_question: string | null;
  help_text: string | null;
  enum_option_labels: Record<string, string>;
};

export type TenantActiveFactVersion = {
  id: string;
  tax_fact_definition_id: string;
  country_code: string | null;
  version_no: number;
  status: string;
  value_type: TaxFactValueType;
  currency_policy: ReturnType<typeof assertCurrencyPolicy>;
  effective_from: string;
  effective_to: string | null;
  enum_codes: string[];
};

export type TenantActiveFactDefinition = {
  id: string;
  fact_key: string;
  country_code: string | null;
  scope: 'global' | 'country';
  status: string;
  semantic_title: string;
  active_version: TenantActiveFactVersion | null;
  presentations: TenantFactPresentation[];
};

function asRecord(row: unknown): Record<string, unknown> {
  return row && typeof row === 'object' && !Array.isArray(row) ? (row as Record<string, unknown>) : {};
}

function asString(row: Record<string, unknown>, field: string): string {
  return String(row[field] ?? '');
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function versionInWindow(effectiveFrom: string, effectiveTo: string | null, asOf: string): boolean {
  return effectiveFrom <= asOf && (effectiveTo == null || effectiveTo >= asOf);
}

function asLabelMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, label] of Object.entries(value as Record<string, unknown>)) {
    if (typeof label === 'string') out[key] = label;
  }
  return out;
}

export function pickFactPresentation(
  presentations: TenantFactPresentation[],
  caseCountry: string,
  locale: string,
): TenantFactPresentation | null {
  const loc = locale.trim().toLowerCase() || 'he';
  const lang = loc.slice(0, 2);
  const ranked = [...presentations].sort((a, b) => {
    const score = (row: TenantFactPresentation) => {
      let n = 0;
      if (row.locale === loc) n += 8;
      else if (row.locale === lang) n += 6;
      else if (row.locale.startsWith(`${lang}-`)) n += 4;
      if (row.country_code === caseCountry) n += 2;
      else if (row.country_code == null) n += 1;
      return n;
    };
    return score(b) - score(a);
  });
  return ranked[0] ?? null;
}

export async function loadTenantActiveFactCatalog(input: {
  countryCode: string;
  asOf: string;
}): Promise<{ definitions: TenantActiveFactDefinition[]; warnings: string[] }> {
  const countryCode = normalizeIsoCountry(input.countryCode);
  if (!countryCode) return { definitions: [], warnings: ['catalog_country_missing'] };
  const warnings: string[] = [];

  const definitionResult = await supabaseAdmin
    .from('tax_fact_definitions')
    .select(DEFINITION_SELECT)
    .eq('status', 'active')
    .or(`country_code.is.null,country_code.eq.${countryCode}`)
    .order('fact_key', { ascending: true });

  if (definitionResult.error && isSupabaseMissingTableError(definitionResult.error, 'tax_fact_definitions')) {
    return { definitions: [], warnings: ['fact_dictionary_schema_not_applied'] };
  }
  if (definitionResult.error) throw definitionResult.error;

  const definitionRows = ((definitionResult.data ?? []) as Record<string, unknown>[]).filter((row) =>
    ownerFactDictionaryIncludesDefinitionCountry(
      typeof row.country_code === 'string' ? row.country_code : null,
      countryCode,
    ),
  );
  const definitionIds = definitionRows.map((row) => String(row.id));
  if (!definitionIds.length) return { definitions: [], warnings };

  const [versionResult, presentationResult] = await Promise.all([
    supabaseAdmin
      .from('tax_fact_definition_versions')
      .select(VERSION_SELECT)
      .eq('status', 'active')
      .in('tax_fact_definition_id', definitionIds)
      .order('version_no', { ascending: true }),
    supabaseAdmin
      .from('tax_fact_presentations')
      .select(PRESENTATION_SELECT)
      .in('tax_fact_definition_id', definitionIds),
  ]);
  if (versionResult.error) throw versionResult.error;
  if (presentationResult.error) throw presentationResult.error;

  const versionRows = ((versionResult.data ?? []) as Record<string, unknown>[]).filter((row) => {
    const versionCountry = typeof row.country_code === 'string' ? row.country_code : null;
    if (!ownerFactDictionaryIncludesDefinitionCountry(versionCountry, countryCode)) return false;
    return versionInWindow(
      asString(row, 'effective_from'),
      row.effective_to == null ? null : String(row.effective_to),
      input.asOf,
    );
  });
  const versionIds = versionRows.map((row) => String(row.id));
  let enumRows: Record<string, unknown>[] = [];
  if (versionIds.length) {
    const enumResult = await supabaseAdmin
      .from('tax_fact_enum_options')
      .select(ENUM_SELECT)
      .in('tax_fact_definition_version_id', versionIds)
      .order('sort_order', { ascending: true })
      .order('code', { ascending: true });
    if (enumResult.error) throw enumResult.error;
    enumRows = (enumResult.data ?? []) as Record<string, unknown>[];
  }

  const enumsByVersion = new Map<string, string[]>();
  for (const row of enumRows) {
    const versionId = String(row.tax_fact_definition_version_id);
    const list = enumsByVersion.get(versionId) ?? [];
    list.push(String(row.code));
    enumsByVersion.set(versionId, list);
  }

  const activeByDefinition = new Map<string, TenantActiveFactVersion>();
  for (const row of versionRows) {
    const definitionId = asString(row, 'tax_fact_definition_id');
    const mapped: TenantActiveFactVersion = {
      id: asString(row, 'id'),
      tax_fact_definition_id: definitionId,
      country_code: asOptionalString(row.country_code),
      version_no: Number(row.version_no),
      status: asString(row, 'status'),
      value_type: asString(row, 'value_type') as TaxFactValueType,
      currency_policy: (() => {
        try {
          return assertCurrencyPolicy(row.currency_policy ?? null, asString(row, 'value_type') as TaxFactValueType);
        } catch {
          return null;
        }
      })(),
      effective_from: asString(row, 'effective_from'),
      effective_to: row.effective_to == null ? null : String(row.effective_to),
      enum_codes: enumsByVersion.get(asString(row, 'id')) ?? [],
    };
    const existing = activeByDefinition.get(definitionId);
    if (!existing || mapped.version_no > existing.version_no) {
      activeByDefinition.set(definitionId, mapped);
    }
  }

  const presentationsByDefinition = new Map<string, TenantFactPresentation[]>();
  for (const raw of presentationResult.data ?? []) {
    const row = asRecord(raw);
    const definitionId = asString(row, 'tax_fact_definition_id');
    const presentationCountry = asOptionalString(row.country_code);
    if (presentationCountry && presentationCountry !== countryCode) continue;
    const list = presentationsByDefinition.get(definitionId) ?? [];
    list.push({
      locale: String(row.locale ?? ''),
      country_code: presentationCountry,
      label: String(row.label ?? ''),
      professional_question: String(row.professional_question ?? ''),
      client_question: asOptionalString(row.client_question),
      help_text: asOptionalString(row.help_text),
      enum_option_labels: asLabelMap(row.enum_option_labels),
    });
    presentationsByDefinition.set(definitionId, list);
  }

  const definitions: TenantActiveFactDefinition[] = [];
  for (const row of definitionRows) {
    const id = String(row.id);
    const country = typeof row.country_code === 'string' ? row.country_code : null;
    const activeVersion = activeByDefinition.get(id) ?? null;
    if (!activeVersion) continue;
    definitions.push({
      id,
      fact_key: String(row.fact_key ?? ''),
      country_code: country,
      scope: country ? 'country' : 'global',
      status: String(row.status ?? ''),
      semantic_title: String(row.semantic_title ?? ''),
      active_version: activeVersion,
      presentations: presentationsByDefinition.get(id) ?? [],
    });
  }

  return { definitions, warnings };
}
