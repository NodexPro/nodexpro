import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { isSupabaseMissingTableError } from '../../shared/supabase-errors.js';
import {
  TAX_KNOWLEDGE_COMMANDS,
  type OwnerTaxKnowledgeAggregateOpts,
  type OwnerTaxKnowledgeAllowedAction,
  type OwnerTaxKnowledgeCountryDto,
  type OwnerTaxRuleDto,
  type OwnerTaxSourceDto,
} from './tax-knowledge.types.js';

const TAX_SOURCE_SELECT =
  'id, country_code, source_code, title, provenance_type, issuer, citation_ref, source_url, published_on, status, owner_note, created_at, updated_at';
const TAX_RULE_SELECT =
  'id, country_code, rule_code, title, rule_kind, status, usage_hint, owner_note, created_at, updated_at';

function normalizeCountryCode(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function mapCountry(row: { code?: string; name?: string; status?: string }): OwnerTaxKnowledgeCountryDto | null {
  if (typeof row.code !== 'string' || !row.code.trim()) return null;
  return {
    code: row.code,
    name: typeof row.name === 'string' ? row.name : row.code,
    status: typeof row.status === 'string' ? row.status : 'active',
  };
}

function mapSource(row: Record<string, unknown>): OwnerTaxSourceDto {
  return {
    id: String(row.id),
    country_code: String(row.country_code),
    source_code: String(row.source_code),
    title: String(row.title),
    provenance_type: String(row.provenance_type),
    issuer: row.issuer == null ? null : String(row.issuer),
    citation_ref: row.citation_ref == null ? null : String(row.citation_ref),
    source_url: row.source_url == null ? null : String(row.source_url),
    published_on: row.published_on == null ? null : String(row.published_on),
    status: String(row.status),
    owner_note: row.owner_note == null ? null : String(row.owner_note),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapRule(row: Record<string, unknown>): OwnerTaxRuleDto {
  return {
    id: String(row.id),
    country_code: String(row.country_code),
    rule_code: String(row.rule_code),
    title: String(row.title),
    rule_kind: String(row.rule_kind),
    status: String(row.status),
    usage_hint: row.usage_hint == null ? null : String(row.usage_hint),
    owner_note: row.owner_note == null ? null : String(row.owner_note),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function allowedActions(): OwnerTaxKnowledgeAllowedAction[] {
  return [
    {
      action_key: 'create_tax_source',
      enabled: true,
      payload: {
        country_code: 'ISO 3166-1 alpha-2',
        source_code: 'string unique per country',
        title: 'string',
        provenance_type:
          'official_law|regulation|circular|official_guidance|case_law_citation|textbook|professional_material|other',
        issuer: 'optional string',
        citation_ref: 'optional string',
        source_url: 'optional string',
        published_on: 'optional YYYY-MM-DD',
        owner_note: 'optional string',
      },
    },
    {
      action_key: 'create_tax_rule',
      enabled: true,
      payload: {
        country_code: 'ISO 3166-1 alpha-2',
        rule_code: 'string unique per country',
        title: 'string',
        rule_kind: 'legal_rule',
        usage_hint: 'optional string',
        owner_note: 'optional string',
      },
    },
  ];
}

async function loadCountryCatalog(
  provided?: OwnerTaxKnowledgeAggregateOpts['countries'],
): Promise<OwnerTaxKnowledgeCountryDto[]> {
  if (provided && provided.length) {
    return provided.map(mapCountry).filter((row): row is OwnerTaxKnowledgeCountryDto => row !== null);
  }

  const { data, error } = await supabaseAdmin
    .from('countries')
    .select('code, name, status')
    .order('code');
  if (error) throw error;
  return (data ?? []).map(mapCountry).filter((row): row is OwnerTaxKnowledgeCountryDto => row !== null);
}

/**
 * Country-scoped Tax Knowledge slice for owner_legal_control_panel_aggregate.
 * Platform/country authoring only — tenant country resolution is not used.
 */
export async function buildOwnerTaxKnowledgeAggregate(
  ctx: RequestContext,
  opts?: OwnerTaxKnowledgeAggregateOpts,
): Promise<Record<string, unknown>> {
  assertPlatformOwner(ctx);

  const countries = await loadCountryCatalog(opts?.countries);
  const selectedCountryCode = normalizeCountryCode(opts?.country_code);
  const warnings: string[] = [];
  let sources: OwnerTaxSourceDto[] = [];
  let rules: OwnerTaxRuleDto[] = [];

  if (selectedCountryCode) {
    const [sourceResult, ruleResult] = await Promise.all([
      supabaseAdmin
        .from('tax_sources')
        .select(TAX_SOURCE_SELECT)
        .eq('country_code', selectedCountryCode)
        .order('updated_at', { ascending: false }),
      supabaseAdmin
        .from('tax_rules')
        .select(TAX_RULE_SELECT)
        .eq('country_code', selectedCountryCode)
        .order('updated_at', { ascending: false }),
    ]);

    if (sourceResult.error && isSupabaseMissingTableError(sourceResult.error, 'tax_sources')) {
      warnings.push('tax_knowledge_schema_not_applied');
    } else if (sourceResult.error) {
      throw sourceResult.error;
    } else {
      sources = (sourceResult.data ?? []).map((row) => mapSource(row as Record<string, unknown>));
    }

    if (ruleResult.error && isSupabaseMissingTableError(ruleResult.error, 'tax_rules')) {
      if (!warnings.includes('tax_knowledge_schema_not_applied')) {
        warnings.push('tax_knowledge_schema_not_applied');
      }
    } else if (ruleResult.error) {
      throw ruleResult.error;
    } else {
      rules = (ruleResult.data ?? []).map((row) => mapRule(row as Record<string, unknown>));
    }
  }

  return {
    selected_country_code: selectedCountryCode,
    countries,
    sources,
    rules,
    allowed_actions: allowedActions(),
    implemented_commands: [...TAX_KNOWLEDGE_COMMANDS],
    warnings,
  };
}
