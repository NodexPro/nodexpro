import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { isSupabaseMissingTableError } from '../../shared/supabase-errors.js';
import {
  TAX_KNOWLEDGE_COMMANDS,
  TAX_RULE_CITED_INSTRUMENT_KIND_LABELS,
  TAX_RULE_CITED_INSTRUMENT_KINDS,
  TAX_RULE_RELATIONSHIP_TYPE_LABELS,
  TAX_RULE_RELATIONSHIP_TYPES,
  TAX_RULE_UNRESOLVED_STATUS_LABELS,
  type OwnerTaxKnowledgeAggregateOpts,
  type OwnerTaxKnowledgeAllowedAction,
  type OwnerTaxKnowledgeLabeledOption,
  type OwnerTaxKnowledgeSupersessionPair,
  type OwnerTaxKnowledgeCountryDto,
  type OwnerTaxRuleDto,
  type OwnerTaxRuleRelationshipDto,
  type OwnerTaxRuleUnresolvedLegalReferenceDto,
  type OwnerTaxRuleUnresolvedResolveCandidate,
  type OwnerTaxRuleVersionDto,
  type OwnerTaxRuleVersionLegalValueDto,
  type OwnerTaxRuleVersionSourceDto,
  type OwnerTaxSourceDto,
  type TaxRuleCitedInstrumentKind,
  type TaxRuleRelationshipType,
  type TaxRuleUnresolvedStatus,
} from './tax-knowledge.types.js';
import { isExpectedPreK3cSchemaAbsence } from './tax-knowledge-unresolved.pure.js';

const TAX_SOURCE_SELECT =
  'id, country_code, source_code, title, provenance_type, issuer, citation_ref, source_url, published_on, status, owner_note, retired_at, retired_reason, created_at, updated_at';
const TAX_RULE_SELECT =
  'id, country_code, rule_code, title, rule_kind, status, usage_hint, owner_note, created_at, updated_at';
const TAX_RULE_VERSION_SELECT =
  'id, tax_rule_id, country_code, country_pack_id, country_pack_ruleset_id, version_no, status, effective_from, effective_to, payload_json, payload_checksum, supersedes_version_id, superseded_by_version_id, retired_at, retired_reason, created_at';

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
  candidates?: OwnerTaxKnowledgeSupersessionPair[],
): OwnerTaxKnowledgeAllowedAction {
  return candidates ? { action_key: actionKey, enabled, payload, candidates } : { action_key: actionKey, enabled, payload };
}

type VersionPairingRow = {
  id: string;
  tax_rule_id: string;
  country_code: string;
  status: string;
  supersedes_version_id: string | null;
};

function asPairingRow(row: Record<string, unknown>): VersionPairingRow {
  return {
    id: String(row.id),
    tax_rule_id: String(row.tax_rule_id),
    country_code: String(row.country_code),
    status: String(row.status),
    supersedes_version_id: row.supersedes_version_id == null ? null : String(row.supersedes_version_id),
  };
}

function lineageCompatible(neu: VersionPairingRow, old: VersionPairingRow): boolean {
  return neu.supersedes_version_id == null || neu.supersedes_version_id === old.id;
}

function eligibleSupersessionPairs(
  version: VersionPairingRow,
  siblings: VersionPairingRow[],
): OwnerTaxKnowledgeSupersessionPair[] {
  const pairs: OwnerTaxKnowledgeSupersessionPair[] = [];
  for (const other of siblings) {
    if (other.id === version.id) continue;
    if (other.tax_rule_id !== version.tax_rule_id) continue;
    if (other.country_code !== version.country_code) continue;
    if (version.status === 'draft' && other.status === 'active' && lineageCompatible(version, other)) {
      pairs.push({
        new_tax_rule_version_id: version.id,
        old_tax_rule_version_id: other.id,
      });
    } else if (version.status === 'active' && other.status === 'draft' && lineageCompatible(other, version)) {
      pairs.push({
        new_tax_rule_version_id: other.id,
        old_tax_rule_version_id: version.id,
      });
    }
  }
  pairs.sort((a, b) => {
    const byNew = a.new_tax_rule_version_id.localeCompare(b.new_tax_rule_version_id);
    return byNew !== 0 ? byNew : a.old_tax_rule_version_id.localeCompare(b.old_tax_rule_version_id);
  });
  return pairs;
}

function supersedeAllowedAction(
  version: VersionPairingRow,
  siblings: VersionPairingRow[],
): OwnerTaxKnowledgeAllowedAction {
  const candidates = eligibleSupersessionPairs(version, siblings);
  const enabled = candidates.length > 0;
  const payload =
    candidates.length === 1
      ? {
          new_tax_rule_version_id: candidates[0].new_tax_rule_version_id,
          old_tax_rule_version_id: candidates[0].old_tax_rule_version_id,
        }
      : {
          new_tax_rule_version_id: '',
          old_tax_rule_version_id: '',
        };
  return action('supersede_tax_rule_version', enabled, payload, candidates);
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

function versionAllowedActions(
  version: VersionPairingRow,
  siblings: VersionPairingRow[],
): OwnerTaxKnowledgeAllowedAction[] {
  const draft = version.status === 'draft';
  const active = version.status === 'active';
  const canRetire = version.status === 'draft' || version.status === 'active' || version.status === 'superseded';
  return [
    action('update_tax_rule_version_draft', draft, {
      tax_rule_version_id: 'uuid',
      country_pack_id: 'optional uuid',
      country_pack_ruleset_id: 'optional uuid',
      effective_from: 'optional YYYY-MM-DD',
      effective_to: 'optional YYYY-MM-DD',
      payload_json: 'optional JSON object',
    }),
    action('pin_tax_rule_version_source', draft, {
      tax_rule_version_id: 'uuid',
      tax_source_id: 'uuid',
      locator: 'optional string',
    }),
    action('bind_tax_rule_version_legal_value', draft, {
      tax_rule_version_id: 'uuid',
      legal_value_id: 'uuid',
    }),
    action('create_tax_rule_relationship', draft, {
      from_tax_rule_version_id: 'uuid',
      to_tax_rule_version_id: 'uuid',
      relationship_type: TAX_RULE_RELATIONSHIP_TYPES.join('|'),
      activation_critical: 'required true|false when procedural_requirement',
      owner_note: 'optional string',
    }),
    action('create_tax_rule_unresolved_legal_reference', draft, {
      from_tax_rule_version_id: 'uuid',
      relationship_intent: TAX_RULE_RELATIONSHIP_TYPES.join('|'),
      locator_text: 'string',
      cited_instrument_kind: 'law|section|regulation|instruction|order|other',
      activation_critical: 'required true|false when procedural_requirement and open',
    }),
    action('activate_tax_rule_version', draft, {
      tax_rule_version_id: 'uuid',
    }),
    action('retire_tax_rule_version', canRetire, {
      tax_rule_version_id: 'uuid',
      reason: 'optional string',
    }),
    action('close_tax_rule_version_effective_to', active, {
      tax_rule_version_id: 'uuid',
      effective_to: 'YYYY-MM-DD',
    }),
    supersedeAllowedAction(version, siblings),
  ];
}

function citationAllowedActions(parentDraft: boolean): OwnerTaxKnowledgeAllowedAction[] {
  return [
    action('unpin_tax_rule_version_source', parentDraft, {
      tax_rule_version_source_id: 'uuid',
    }),
  ];
}

function bindingAllowedActions(parentDraft: boolean): OwnerTaxKnowledgeAllowedAction[] {
  return [
    action('unbind_tax_rule_version_legal_value', parentDraft, {
      tax_rule_version_legal_value_id: 'uuid',
    }),
  ];
}

function relationshipAllowedActions(fromDraft: boolean): OwnerTaxKnowledgeAllowedAction[] {
  return [
    action('delete_tax_rule_relationship', fromDraft, {
      tax_rule_relationship_id: 'uuid',
    }),
  ];
}

function relationshipTypeLabel(type: string): string {
  return TAX_RULE_RELATIONSHIP_TYPE_LABELS[type as TaxRuleRelationshipType] ?? type;
}

function activationCriticalLabel(type: string, value: boolean | null): string | null {
  if (type !== 'procedural_requirement') return null;
  if (value === true) return 'Mandatory to apply the rule';
  if (value === false) return 'Procedural guidance only';
  return 'Not classified';
}

function citedDisplay(row: {
  cited_law_name: string | null;
  cited_title: string | null;
  cited_instrument_kind: string;
  cited_provision_number: string | null;
  locator_text: string;
}): string {
  const kind = TAX_RULE_CITED_INSTRUMENT_KIND_LABELS[row.cited_instrument_kind as TaxRuleCitedInstrumentKind]
    ?? row.cited_instrument_kind;
  const parts = [
    row.cited_law_name,
    row.cited_title,
    [kind, row.cited_provision_number].filter(Boolean).join(' '),
    row.locator_text,
  ].filter((part): part is string => Boolean(part && part.trim()));
  return parts.join(' · ');
}

function unresolvedAllowedActions(
  fromStatus: string,
  status: string,
): OwnerTaxKnowledgeAllowedAction[] {
  const fromDraft = fromStatus === 'draft';
  const open = status === 'open';
  const draft = status === 'draft';
  return [
    action('update_tax_rule_unresolved_legal_reference', fromDraft && (draft || open), {
      tax_rule_unresolved_legal_reference_id: 'uuid',
    }),
    action('accept_tax_rule_unresolved_legal_reference', fromDraft && draft, {
      tax_rule_unresolved_legal_reference_id: 'uuid',
      activation_critical: 'required true|false when procedural_requirement',
    }),
    action('discard_tax_rule_unresolved_legal_reference', (fromDraft && (draft || open)) || (!fromDraft && open), {
      tax_rule_unresolved_legal_reference_id: 'uuid',
      discarded_reason: 'optional string',
    }),
    action('resolve_tax_rule_unresolved_legal_reference', open, {
      tax_rule_unresolved_legal_reference_id: 'uuid',
      to_tax_rule_version_id: 'uuid',
    }),
  ];
}

function labeledRelationshipOptions(): OwnerTaxKnowledgeLabeledOption[] {
  return TAX_RULE_RELATIONSHIP_TYPES.map((value) => ({
    value,
    label: TAX_RULE_RELATIONSHIP_TYPE_LABELS[value],
  }));
}

function labeledInstrumentOptions(): OwnerTaxKnowledgeLabeledOption[] {
  return TAX_RULE_CITED_INSTRUMENT_KINDS.map((value) => ({
    value,
    label: TAX_RULE_CITED_INSTRUMENT_KIND_LABELS[value],
  }));
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

function mapVersion(
  row: Record<string, unknown>,
  sources: OwnerTaxRuleVersionSourceDto[],
  legalValueBindings: OwnerTaxRuleVersionLegalValueDto[],
  relationships: OwnerTaxRuleRelationshipDto[],
  unresolvedLegalReferences: OwnerTaxRuleUnresolvedLegalReferenceDto[],
  siblings: VersionPairingRow[],
): OwnerTaxRuleVersionDto {
  const status = String(row.status);
  const rawPayload = row.payload_json;
  const payloadJson =
    rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
      ? (rawPayload as Record<string, unknown>)
      : {};
  const pairing = asPairingRow(row);
  return {
    id: pairing.id,
    tax_rule_id: pairing.tax_rule_id,
    country_code: pairing.country_code,
    version_no: Number(row.version_no),
    status,
    country_pack_id: String(row.country_pack_id),
    country_pack_ruleset_id: String(row.country_pack_ruleset_id),
    effective_from: String(row.effective_from),
    effective_to: row.effective_to == null ? null : String(row.effective_to),
    payload_json: payloadJson,
    payload_checksum: String(row.payload_checksum),
    supersedes_version_id: pairing.supersedes_version_id,
    superseded_by_version_id: row.superseded_by_version_id == null ? null : String(row.superseded_by_version_id),
    retired_at: row.retired_at == null ? null : String(row.retired_at),
    retired_reason: row.retired_reason == null ? null : String(row.retired_reason),
    created_at: String(row.created_at),
    sources,
    legal_value_bindings: legalValueBindings,
    relationships,
    unresolved_legal_references: unresolvedLegalReferences,
    allowed_actions: versionAllowedActions(pairing, siblings),
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
    const [sourceResult, ruleResult, versionResult, citationResult, bindingResult, relationshipResult, unresolvedResult] = await Promise.all([
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
      supabaseAdmin
        .from('tax_rule_version_sources')
        .select('id, tax_rule_version_id, tax_source_id, locator, created_at')
        .eq('country_code', selectedCountryCode)
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('tax_rule_version_legal_values')
        .select('id, tax_rule_version_id, legal_value_id, created_at')
        .eq('country_code', selectedCountryCode)
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('tax_rule_relationships')
        .select(
          'id, from_tax_rule_version_id, to_tax_rule_version_id, relationship_type, activation_critical, status, owner_note, created_at',
        )
        .eq('country_code', selectedCountryCode)
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('tax_rule_unresolved_legal_references')
        .select(
          'id, from_tax_rule_version_id, relationship_intent, activation_critical, cited_title, cited_law_name, cited_instrument_kind, cited_provision_number, locator_text, source_tax_source_id, source_locator, status, resolved_to_tax_rule_version_id, resolved_relationship_id, owner_note, created_at, resolved_at, discarded_at, discarded_reason',
        )
        .eq('country_code', selectedCountryCode)
        .order('created_at', { ascending: true }),
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
    }

    if (citationResult.error && isSupabaseMissingTableError(citationResult.error, 'tax_rule_version_sources')) {
      if (!warnings.includes('tax_knowledge_schema_not_applied')) {
        warnings.push('tax_knowledge_schema_not_applied');
      }
    } else if (citationResult.error) {
      throw citationResult.error;
    }

    if (bindingResult.error && isSupabaseMissingTableError(bindingResult.error, 'tax_rule_version_legal_values')) {
      if (!warnings.includes('tax_knowledge_schema_not_applied')) {
        warnings.push('tax_knowledge_schema_not_applied');
      }
    } else if (bindingResult.error) {
      throw bindingResult.error;
    }

    let relationshipRows = relationshipResult.data;
    if (relationshipResult.error && isSupabaseMissingTableError(relationshipResult.error, 'tax_rule_relationships')) {
      if (!warnings.includes('tax_knowledge_schema_not_applied')) {
        warnings.push('tax_knowledge_schema_not_applied');
      }
    } else if (relationshipResult.error && isExpectedPreK3cSchemaAbsence(relationshipResult.error, 'undefined_column')) {
      const retry = await supabaseAdmin
        .from('tax_rule_relationships')
        .select(
          'id, from_tax_rule_version_id, to_tax_rule_version_id, relationship_type, status, owner_note, created_at',
        )
        .eq('country_code', selectedCountryCode)
        .order('created_at', { ascending: true });
      if (retry.error) throw relationshipResult.error;
      relationshipRows = retry.data;
    } else if (relationshipResult.error) {
      throw relationshipResult.error;
    }

    if (
      unresolvedResult.error
      && isExpectedPreK3cSchemaAbsence(unresolvedResult.error, 'undefined_table')
    ) {
      warnings.push('tax_knowledge_k3c_schema_not_applied');
    } else if (unresolvedResult.error) {
      throw unresolvedResult.error;
    }

    const sourceById = new Map(sources.map((row) => [row.id, row]));
    const legalValueIds = [
      ...new Set((bindingResult.data ?? []).map((row) => String((row as { legal_value_id: string }).legal_value_id))),
    ];
    const legalValueById = new Map<
      string,
      { value_key: string; label: string; category: string | null; module_scope: string | null; status: string }
    >();
    if (legalValueIds.length) {
      const legalValues = await supabaseAdmin
        .from('country_legal_values')
        .select('id, value_key, label, category, module_scope, status')
        .eq('country_code', selectedCountryCode)
        .in('id', legalValueIds);
      if (legalValues.error) throw legalValues.error;
      for (const row of legalValues.data ?? []) {
        legalValueById.set(String(row.id), {
          value_key: String(row.value_key),
          label: String(row.label),
          category: row.category == null ? null : String(row.category),
          module_scope: row.module_scope == null ? null : String(row.module_scope),
          status: String(row.status),
        });
      }
    }

    if (!versionResult.error) {
      const citationsByVersion = new Map<string, OwnerTaxRuleVersionSourceDto[]>();
      for (const row of citationResult.data ?? []) {
        const versionId = String((row as { tax_rule_version_id: string }).tax_rule_version_id);
        const sourceId = String((row as { tax_source_id: string }).tax_source_id);
        const source = sourceById.get(sourceId);
        const parent = (versionResult.data ?? []).find((v) => String((v as { id: string }).id) === versionId) as
          | { status?: string }
          | undefined;
        const list = citationsByVersion.get(versionId) ?? [];
        list.push({
          id: String((row as { id: string }).id),
          tax_rule_version_id: versionId,
          tax_source_id: sourceId,
          source_code: source?.source_code ?? '',
          title: source?.title ?? '',
          provenance_type: source?.provenance_type ?? '',
          status: source?.status ?? '',
          locator: (row as { locator?: string | null }).locator == null ? null : String((row as { locator: string }).locator),
          created_at: String((row as { created_at: string }).created_at),
          allowed_actions: citationAllowedActions(parent?.status === 'draft'),
        });
        citationsByVersion.set(versionId, list);
      }

      const bindingsByVersion = new Map<string, OwnerTaxRuleVersionLegalValueDto[]>();
      for (const row of bindingResult.data ?? []) {
        const versionId = String((row as { tax_rule_version_id: string }).tax_rule_version_id);
        const legalValueId = String((row as { legal_value_id: string }).legal_value_id);
        const legal = legalValueById.get(legalValueId);
        const parent = (versionResult.data ?? []).find((v) => String((v as { id: string }).id) === versionId) as
          | { status?: string }
          | undefined;
        const list = bindingsByVersion.get(versionId) ?? [];
        list.push({
          id: String((row as { id: string }).id),
          tax_rule_version_id: versionId,
          legal_value_id: legalValueId,
          value_key: legal?.value_key ?? '',
          label: legal?.label ?? '',
          category: legal?.category ?? null,
          module_scope: legal?.module_scope ?? null,
          status: legal?.status ?? '',
          created_at: String((row as { created_at: string }).created_at),
          allowed_actions: bindingAllowedActions(parent?.status === 'draft'),
        });
        bindingsByVersion.set(versionId, list);
      }

      const ruleMetaById = new Map(
        (ruleResult.data ?? []).map((row) => {
          const mapped = row as { id: string; rule_code: string; title: string };
          return [
            String(mapped.id),
            { rule_code: String(mapped.rule_code), title: String(mapped.title) },
          ] as const;
        }),
      );
      const versionMetaById = new Map(
        (versionResult.data ?? []).map((row) => {
          const mapped = row as { id: string; tax_rule_id: string; version_no: number; status: string };
          return [
            String(mapped.id),
            {
              tax_rule_id: String(mapped.tax_rule_id),
              version_no: Number(mapped.version_no),
              status: String(mapped.status),
            },
          ] as const;
        }),
      );

      const relationshipsByFrom = new Map<string, OwnerTaxRuleRelationshipDto[]>();
      for (const row of relationshipRows ?? []) {
        const fromId = String((row as { from_tax_rule_version_id: string }).from_tax_rule_version_id);
        const toId = String((row as { to_tax_rule_version_id: string }).to_tax_rule_version_id);
        const toVersion = versionMetaById.get(toId);
        const toRule = toVersion ? ruleMetaById.get(toVersion.tax_rule_id) : undefined;
        const fromVersion = versionMetaById.get(fromId);
        const list = relationshipsByFrom.get(fromId) ?? [];
        const relationshipType = String((row as { relationship_type: string }).relationship_type);
        const activationCritical =
          (row as { activation_critical?: boolean | null }).activation_critical === true
            ? true
            : (row as { activation_critical?: boolean | null }).activation_critical === false
              ? false
              : null;
        list.push({
          id: String((row as { id: string }).id),
          from_tax_rule_version_id: fromId,
          to_tax_rule_version_id: toId,
          relationship_type: relationshipType,
          relationship_type_label: relationshipTypeLabel(relationshipType),
          activation_critical: activationCritical,
          activation_critical_label: activationCriticalLabel(relationshipType, activationCritical),
          status: String((row as { status: string }).status),
          owner_note:
            (row as { owner_note?: string | null }).owner_note == null
              ? null
              : String((row as { owner_note: string }).owner_note),
          created_at: String((row as { created_at: string }).created_at),
          to_tax_rule_id: toVersion?.tax_rule_id ?? '',
          to_rule_code: toRule?.rule_code ?? '',
          to_title: toRule?.title ?? '',
          to_version_no: toVersion?.version_no ?? 0,
          to_status: toVersion?.status ?? '',
          allowed_actions: relationshipAllowedActions(fromVersion?.status === 'draft'),
        });
        relationshipsByFrom.set(fromId, list);
      }

      const resolveCandidates: OwnerTaxRuleUnresolvedResolveCandidate[] = (versionResult.data ?? [])
        .map((row) => {
          const mapped = row as { id: string; tax_rule_id: string; version_no: number; status: string };
          const rule = ruleMetaById.get(String(mapped.tax_rule_id));
          return {
            tax_rule_version_id: String(mapped.id),
            tax_rule_id: String(mapped.tax_rule_id),
            rule_code: rule?.rule_code ?? '',
            title: rule?.title ?? '',
            version_no: Number(mapped.version_no),
            status: String(mapped.status),
          };
        })
        .filter((row) => row.status === 'active');

      const unresolvedByFrom = new Map<string, OwnerTaxRuleUnresolvedLegalReferenceDto[]>();
      for (const raw of unresolvedResult.data ?? []) {
        const row = raw as Record<string, unknown>;
        const fromId = String(row.from_tax_rule_version_id);
        const intent = String(row.relationship_intent);
        const status = String(row.status) as TaxRuleUnresolvedStatus;
        const activationCritical =
          row.activation_critical === true ? true : row.activation_critical === false ? false : null;
        const locatorText = String(row.locator_text);
        const cited = {
          cited_law_name: row.cited_law_name == null ? null : String(row.cited_law_name),
          cited_title: row.cited_title == null ? null : String(row.cited_title),
          cited_instrument_kind: String(row.cited_instrument_kind),
          cited_provision_number: row.cited_provision_number == null ? null : String(row.cited_provision_number),
          locator_text: locatorText,
        };
        const fromVersion = versionMetaById.get(fromId);
        const list = unresolvedByFrom.get(fromId) ?? [];
        list.push({
          id: String(row.id),
          from_tax_rule_version_id: fromId,
          relationship_intent: intent,
          relationship_intent_label: relationshipTypeLabel(intent),
          activation_critical: activationCritical,
          activation_critical_label: activationCriticalLabel(intent, activationCritical),
          cited_title: cited.cited_title,
          cited_law_name: cited.cited_law_name,
          cited_instrument_kind: cited.cited_instrument_kind,
          cited_instrument_kind_label:
            TAX_RULE_CITED_INSTRUMENT_KIND_LABELS[cited.cited_instrument_kind as TaxRuleCitedInstrumentKind]
            ?? cited.cited_instrument_kind,
          cited_provision_number: cited.cited_provision_number,
          locator_text: locatorText,
          cited_display: citedDisplay(cited),
          source_tax_source_id: row.source_tax_source_id == null ? null : String(row.source_tax_source_id),
          source_locator: row.source_locator == null ? null : String(row.source_locator),
          status,
          status_label: TAX_RULE_UNRESOLVED_STATUS_LABELS[status] ?? status,
          resolved_to_tax_rule_version_id:
            row.resolved_to_tax_rule_version_id == null ? null : String(row.resolved_to_tax_rule_version_id),
          resolved_relationship_id:
            row.resolved_relationship_id == null ? null : String(row.resolved_relationship_id),
          owner_note: row.owner_note == null ? null : String(row.owner_note),
          created_at: String(row.created_at),
          resolved_at: row.resolved_at == null ? null : String(row.resolved_at),
          discarded_at: row.discarded_at == null ? null : String(row.discarded_at),
          discarded_reason: row.discarded_reason == null ? null : String(row.discarded_reason),
          resolve_candidates: status === 'open'
            ? resolveCandidates.filter((candidate) => candidate.tax_rule_version_id !== fromId)
            : [],
          allowed_actions: unresolvedAllowedActions(fromVersion?.status ?? '', status),
        });
        unresolvedByFrom.set(fromId, list);
      }

      const pairingRows = (versionResult.data ?? []).map((row) => asPairingRow(row as Record<string, unknown>));
      ruleVersions = (versionResult.data ?? []).map((row) => {
        const mapped = row as Record<string, unknown>;
        const id = String(mapped.id);
        return mapVersion(
          mapped,
          citationsByVersion.get(id) ?? [],
          bindingsByVersion.get(id) ?? [],
          relationshipsByFrom.get(id) ?? [],
          unresolvedByFrom.get(id) ?? [],
          pairingRows,
        );
      });
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
    relationship_type_options: labeledRelationshipOptions(),
    cited_instrument_kind_options: labeledInstrumentOptions(),
    activation_critical_options: [
      { value: 'true', label: 'Mandatory to apply the rule' },
      { value: 'false', label: 'Procedural guidance only' },
    ],
    warnings,
  };
}
