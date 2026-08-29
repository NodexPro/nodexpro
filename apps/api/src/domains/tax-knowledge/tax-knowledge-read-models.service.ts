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
  type OwnerTaxRuleVersionDto,
  type OwnerTaxSourceDto,
} from './tax-knowledge.types.js';

const TAX_SOURCE_SELECT =
  'id, country_code, source_code, title, provenance_type, issuer, citation_ref, source_url, published_on, status, owner_note, retired_at, retired_reason, created_at, updated_at';
const TAX_RULE_SELECT =
  'id, country_code, rule_code, title, rule_kind, status, usage_hint, owner_note, created_at, updated_at';
const TAX_RULE_VERSION_SELECT =
  'id, tax_rule_id, country_code, country_pack_id, country_pack_ruleset_id, version_no, status, effective_from, effective_to, payload_json, payload_checksum, supersedes_version_id, created_at';

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

function action(
  actionKey: OwnerTaxKnowledgeAllowedAction['action_key'],
  enabled: boolean,
  payload: Record<string, string>,
): OwnerTaxKnowledgeAllowedAction {
  return { action_key: actionKey, enabled, payload };
}

function sourceAllowedActions(status: string): OwnerTaxKnowledgeAllowedAction[] {
  const metadata = action('update_tax_source_metadata', status === 'draft' || status === 'active', {
    tax_source_id: 'uuid',
    title: 'optional string',
    provenance_type: 'optional provenance type',
    issuer: 'optional string',
    citation_ref: 'optional string',
    source_url: 'optional string',
    published_on: 'optional YYYY-MM-DD',
    owner_note: 'optional string',
  });
  const activate = action('activate_tax_source', status === 'draft', { tax_source_id: 'uuid' });
  const retire = action('retire_tax_source', status === 'draft' || status === 'active', {
    tax_source_id: 'uuid',
    reason: 'optional string',
  });
  return [metadata, activate, retire];
}

function ruleAllowedActions(): OwnerTaxKnowledgeAllowedAction[] {
  return [
    action('update_tax_rule_metadata', true, {
      tax_rule_id: 'uuid',
      title: 'optional string',
      usage_hint: 'optional string',
      owner_note: 'optional string',
    }),
    action('create_tax_rule_version', true, {
      tax_rule_id: 'uuid',
      country_pack_id: 'uuid',
      country_pack_ruleset_id: 'uuid',
      effective_from: 'YYYY-MM-DD',
      effective_to: 'optional YYYY-MM-DD',
      payload_json: 'JSON object',
      supersedes_version_id: 'optional uuid',
    }),
  ];
}

function versionAllowedActions(status: string): OwnerTaxKnowledgeAllowedAction[] {
  return [
    action('update_tax_rule_version_draft', status === 'draft', {
      tax_rule_version_id: 'uuid',
      country_pack_id: 'optional uuid',
      country_pack_ruleset_id: 'optional uuid',
      effective_from: 'optional YYYY-MM-DD',
      effective_to: 'optional YYYY-MM-DD',
      payload_json: 'optional JSON object',
    }),
  ];
}

function mapSource(row: Record<string, unknown>): OwnerTaxSourceDto {
  const status = String(row.status);
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
    status,
    owner_note: row.owner_note == null ? null : String(row.owner_note),
    retired_at: row.retired_at == null ? null : String(row.retired_at),
    retired_reason: row.retired_reason == null ? null : String(row.retired_reason),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    allowed_actions: sourceAllowedActions(status),
  };
}

function mapVersion(row: Record<string, unknown>): OwnerTaxRuleVersionDto {
  const status = String(row.status);
  const rawPayload = row.payload_json;
  const payloadJson =
    rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
      ? (rawPayload as Record<string, unknown>)
      : {};
  return {
    id: String(row.id),
    tax_rule_id: String(row.tax_rule_id),
    country_code: String(row.country_code),
    version_no: Number(row.version_no),
    status,
    country_pack_id: String(row.country_pack_id),
    country_pack_ruleset_id: String(row.country_pack_ruleset_id),
    effective_from: String(row.effective_from),
    effective_to: row.effective_to == null ? null : String(row.effective_to),
    payload_json: payloadJson,
    payload_checksum: String(row.payload_checksum),
    supersedes_version_id: row.supersedes_version_id == null ? null : String(row.supersedes_version_id),
    created_at: String(row.created_at),
    allowed_actions: versionAllowedActions(status),
  };
}

function mapRule(row: Record<string, unknown>, versions: OwnerTaxRuleVersionDto[]): OwnerTaxRuleDto {
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
    versions,
    allowed_actions: ruleAllowedActions(),
  };
}

function catalogAllowedActions(): OwnerTaxKnowledgeAllowedAction[] {
  return [
    action('create_tax_source', true, {
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
    }),
    action('create_tax_rule', true, {
      country_code: 'ISO 3166-1 alpha-2',
      rule_code: 'string unique per country',
      title: 'string',
      rule_kind: 'legal_rule',
      usage_hint: 'optional string',
      owner_note: 'optional string',
    }),
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
  let ruleVersions: OwnerTaxRuleVersionDto[] = [];

  if (selectedCountryCode) {
    const [sourceResult, ruleResult, versionResult] = await Promise.all([
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
      supabaseAdmin
        .from('tax_rule_versions')
        .select(TAX_RULE_VERSION_SELECT)
        .eq('country_code', selectedCountryCode)
        .order('version_no', { ascending: true }),
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
    }

    if (versionResult.error && isSupabaseMissingTableError(versionResult.error, 'tax_rule_versions')) {
      if (!warnings.includes('tax_knowledge_schema_not_applied')) {
        warnings.push('tax_knowledge_schema_not_applied');
      }
    } else if (versionResult.error) {
      throw versionResult.error;
    } else {
      ruleVersions = (versionResult.data ?? []).map((row) => mapVersion(row as Record<string, unknown>));
    }

    if (!ruleResult.error) {
      const versionsByRule = new Map<string, OwnerTaxRuleVersionDto[]>();
      for (const version of ruleVersions) {
        const list = versionsByRule.get(version.tax_rule_id) ?? [];
        list.push(version);
        versionsByRule.set(version.tax_rule_id, list);
      }
      rules = (ruleResult.data ?? []).map((row) => {
        const mappedRow = row as Record<string, unknown>;
        return mapRule(mappedRow, versionsByRule.get(String(mappedRow.id)) ?? []);
      });
    }
  }

  return {
    selected_country_code: selectedCountryCode,
    countries,
    sources,
    rules,
    rule_versions: ruleVersions,
    allowed_actions: catalogAllowedActions(),
    implemented_commands: [...TAX_KNOWLEDGE_COMMANDS],
    warnings,
  };
}
