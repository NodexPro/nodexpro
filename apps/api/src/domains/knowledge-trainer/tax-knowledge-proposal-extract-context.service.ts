import { supabaseAdmin } from '../../db/client.js';
import { taxKnowledgeProposalExtractStaticVocab } from './tax-knowledge-proposal-extract-v1.js';
import {
  ANCESTOR_LIMIT,
  FACT_DEFINITION_LIMIT,
  LEGAL_VALUE_KEY_LIMIT,
  MATCHED_LEGAL_NODE_LIMIT,
  buildCanonicalAllowlist,
  legalNodeMatchQueriesForExtraction,
  type ControlledExtractionContext,
  type GenerateDraftRow,
  type LegalNodeMatchQuery,
} from './tax-knowledge-proposal-extract.pure.js';
import {
  TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PROMPT_VERSION,
  TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PURPOSE,
} from './tax-knowledge-proposal-extract-v1.js';

function asNullable(value: unknown): string | null {
  if (value == null || value === '') return null;
  return String(value);
}

async function loadAncestors(startParentId: string | null): Promise<ControlledExtractionContext['ancestors']> {
  const ancestors: ControlledExtractionContext['ancestors'] = [];
  let current = startParentId;
  const seen = new Set<string>();
  while (current && ancestors.length < ANCESTOR_LIMIT && !seen.has(current)) {
    seen.add(current);
    const { data, error } = await supabaseAdmin
      .from('legal_ingestion_legal_text_drafts')
      .select(
        'id, parent_draft_id, kind_label, title, source_display_identifier, normalized_machine_identifier, draft_legal_text',
      )
      .eq('id', current)
      .maybeSingle();
    if (error) throw error;
    if (!data) break;
    ancestors.push({
      id: String(data.id),
      kind_label: asNullable(data.kind_label),
      title: asNullable(data.title),
      source_display_identifier: asNullable(data.source_display_identifier),
      normalized_machine_identifier: asNullable(data.normalized_machine_identifier),
      draft_legal_text: String(data.draft_legal_text ?? ''),
    });
    current = asNullable(data.parent_draft_id);
  }
  return ancestors;
}

async function loadMatchingLegalNodes(
  draft: GenerateDraftRow,
  ancestors: ControlledExtractionContext['ancestors'],
): Promise<ControlledExtractionContext['existing_legal_nodes']> {
  const matchQueries = legalNodeMatchQueriesForExtraction(draft, ancestors);
  const byId = new Map<string, ControlledExtractionContext['existing_legal_nodes'][number]>();
  const take = async (
    column: 'normalized_machine_identifier' | 'source_display_identifier',
    value: string,
    matchedFrom: LegalNodeMatchQuery['matched_from'],
  ) => {
    if (byId.size >= MATCHED_LEGAL_NODE_LIMIT) return;
    const { data, error } = await supabaseAdmin
      .from('tax_legal_nodes')
      .select('id, title, source_display_identifier, normalized_machine_identifier, node_number, status')
      .eq('country_code', draft.country_code)
      .eq('tax_source_id', draft.tax_source_id)
      .eq(column, value)
      .limit(MATCHED_LEGAL_NODE_LIMIT);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = String(row.id);
      if (byId.has(id) || byId.size >= MATCHED_LEGAL_NODE_LIMIT) continue;
      byId.set(id, {
        id,
        title: asNullable(row.title),
        source_display_identifier: asNullable(row.source_display_identifier),
        normalized_machine_identifier: asNullable(row.normalized_machine_identifier),
        node_number: asNullable(row.node_number),
        status: asNullable(row.status),
        matched_from: matchedFrom,
      });
    }
  };
  for (const query of matchQueries) {
    const normalized = query.normalized_machine_identifier?.trim() || null;
    const display = query.source_display_identifier?.trim() || null;
    if (normalized) await take('normalized_machine_identifier', normalized, query.matched_from);
    if (display && display !== normalized) await take('source_display_identifier', display, query.matched_from);
  }
  return [...byId.values()];
}

async function loadFactDefinitions(countryCode: string): Promise<ControlledExtractionContext['tax_fact_definitions']> {
  const { data: definitions, error } = await supabaseAdmin
    .from('tax_fact_definitions')
    .select('id, fact_key, country_code, status')
    .or(`country_code.is.null,country_code.eq.${countryCode}`)
    .neq('status', 'retired')
    .order('fact_key', { ascending: true })
    .limit(FACT_DEFINITION_LIMIT);
  if (error) throw error;
  const rows = (definitions ?? []) as Array<{
    id: string;
    fact_key: string;
    country_code: string | null;
    status: string;
  }>;
  const ids = rows.map((row) => row.id);
  let versions: Array<{ tax_fact_definition_id: string; status: string; value_type: string; version_no: number; id: string }> =
    [];
  if (ids.length) {
    const { data: versionRows, error: versionError } = await supabaseAdmin
      .from('tax_fact_definition_versions')
      .select('id, tax_fact_definition_id, status, value_type, version_no')
      .in('tax_fact_definition_id', ids)
      .neq('status', 'retired');
    if (versionError) throw versionError;
    versions = (versionRows ?? []) as typeof versions;
  }
  const chosen = new Map<string, (typeof versions)[number]>();
  for (const version of versions) {
    const current = chosen.get(version.tax_fact_definition_id);
    if (!current) {
      chosen.set(version.tax_fact_definition_id, version);
      continue;
    }
    if (current.status !== 'active' && version.status === 'active') {
      chosen.set(version.tax_fact_definition_id, version);
      continue;
    }
    if (current.status === version.status && version.version_no > current.version_no) {
      chosen.set(version.tax_fact_definition_id, version);
    }
  }
  const versionIds = [...chosen.values()].map((row) => row.id);
  const enumCodes = new Map<string, string[]>();
  if (versionIds.length) {
    const { data: enumRows, error: enumError } = await supabaseAdmin
      .from('tax_fact_enum_options')
      .select('tax_fact_definition_version_id, code')
      .in('tax_fact_definition_version_id', versionIds);
    if (enumError) throw enumError;
    for (const row of enumRows ?? []) {
      const versionId = String((row as { tax_fact_definition_version_id: string }).tax_fact_definition_version_id);
      const list = enumCodes.get(versionId) ?? [];
      list.push(String((row as { code: string }).code));
      enumCodes.set(versionId, list);
    }
  }
  return rows.map((row) => {
    const version = chosen.get(row.id);
    return {
      fact_key: row.fact_key,
      country_code: row.country_code,
      value_type: version?.value_type ?? null,
      enum_codes: version ? enumCodes.get(version.id) ?? [] : [],
    };
  });
}

async function loadLegalValueKeys(countryCode: string): Promise<ControlledExtractionContext['country_legal_value_keys']> {
  const { data, error } = await supabaseAdmin
    .from('country_legal_values')
    .select('value_key')
    .eq('country_code', countryCode)
    .neq('status', 'retired')
    .order('value_key', { ascending: true })
    .limit(LEGAL_VALUE_KEY_LIMIT);
  if (error) throw error;
  return (data ?? []).map((row) => ({ value_key: String((row as { value_key: string }).value_key) }));
}

export async function loadControlledExtractionContext(
  draft: GenerateDraftRow,
): Promise<ControlledExtractionContext> {
  const vocab = taxKnowledgeProposalExtractStaticVocab();
  const ancestors = await loadAncestors(draft.parent_draft_id);
  const [existingLegalNodes, facts, legalValueKeys] = await Promise.all([
    loadMatchingLegalNodes(draft, ancestors),
    loadFactDefinitions(draft.country_code),
    loadLegalValueKeys(draft.country_code),
  ]);
  const canonicalAllowlist = buildCanonicalAllowlist({
    existing_legal_nodes: existingLegalNodes,
    tax_source_id: draft.tax_source_id,
  });
  return {
    prompt_contract_version: TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PROMPT_VERSION,
    purpose: TAX_KNOWLEDGE_PROPOSAL_EXTRACT_PURPOSE,
    output_contract: vocab.output_contract,
    output_schema_version: vocab.output_schema_version,
    draft: {
      id: draft.id,
      country_code: draft.country_code,
      tax_source_id: draft.tax_source_id,
      kind_label: draft.kind_label,
      title: draft.title,
      source_display_identifier: draft.source_display_identifier,
      normalized_machine_identifier: draft.normalized_machine_identifier,
      printed_marker: draft.printed_marker,
      draft_legal_text: String(draft.draft_legal_text ?? ''),
    },
    ancestors,
    existing_legal_nodes: existingLegalNodes,
    canonical_allowlist: canonicalAllowlist,
    tax_fact_definitions: facts,
    country_legal_value_keys: legalValueKeys,
    relationship_vocabulary: vocab.relationship_vocabulary,
    k3_predicate_contract: vocab.k3_predicate_contract,
    k4_calculation_hook_contract: vocab.k4_calculation_hook_contract,
    output_contract_keys: vocab.output_contract_keys,
    extraction_outcomes: vocab.extraction_outcomes,
    bounds: {
      matched_legal_nodes: existingLegalNodes.length,
      fact_definitions: facts.length,
      legal_value_keys: legalValueKeys.length,
      ancestors: ancestors.length,
    },
  };
}
