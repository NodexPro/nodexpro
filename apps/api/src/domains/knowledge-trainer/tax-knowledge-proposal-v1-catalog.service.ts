import { supabaseAdmin } from '../../db/client.js';
import {
  collectTaxKnowledgeProposalCatalogRefs,
  validateTaxKnowledgeProposalV1,
} from './tax-knowledge-proposal-v1.pure.js';
import type {
  TaxKnowledgeProposalCatalogFact,
  TaxKnowledgeProposalV1ValidationResult,
  TaxKnowledgeProposalValidationCatalog,
  TaxKnowledgeProposalValidationContext,
} from './tax-knowledge-proposal-v1.types.js';

async function loadByIds<T extends Record<string, unknown>>(
  table: string,
  select: string,
  ids: string[],
): Promise<T[]> {
  if (!ids.length) return [];
  const { data, error } = await supabaseAdmin.from(table).select(select).in('id', ids);
  if (error) throw error;
  return (data ?? []) as unknown as T[];
}

function asString(value: unknown): string {
  return String(value ?? '');
}

function asNullableString(value: unknown): string | null {
  return value == null || value === '' ? null : String(value);
}

export async function loadTaxKnowledgeProposalValidationCatalog(
  countryCode: string,
  proposalJson: unknown,
  pinnedTaxSourceId?: string | null,
): Promise<TaxKnowledgeProposalValidationCatalog> {
  const refs = collectTaxKnowledgeProposalCatalogRefs(proposalJson);
  if (pinnedTaxSourceId && !refs.tax_source_ids.includes(pinnedTaxSourceId)) {
    refs.tax_source_ids.push(pinnedTaxSourceId);
  }
  const country = countryCode.trim().toUpperCase();

  const [legalNodes, legalNodeKinds, taxRules, taxRuleVersions, taxSourcesById, legalValuesById] = await Promise.all([
    loadByIds<{ id: string; country_code: string; tax_source_id: string }>(
      'tax_legal_nodes',
      'id, country_code, tax_source_id',
      refs.legal_node_ids,
    ),
    loadByIds<{ id: string; country_code: string }>(
      'tax_legal_node_kinds',
      'id, country_code',
      refs.legal_node_kind_ids,
    ),
    loadByIds<{ id: string; country_code: string }>('tax_rules', 'id, country_code', refs.tax_rule_ids),
    loadByIds<{ id: string; country_code: string; tax_rule_id: string }>(
      'tax_rule_versions',
      'id, country_code, tax_rule_id',
      refs.tax_rule_version_ids,
    ),
    loadByIds<{ id: string; country_code: string }>('tax_sources', 'id, country_code', refs.tax_source_ids),
    loadByIds<{ id: string; value_key: string; country_code: string; status: string }>(
      'country_legal_values',
      'id, value_key, country_code, status',
      refs.legal_value_ids,
    ),
  ]);

  let legalValuesByKey: Array<{ id: string; value_key: string; country_code: string; status: string }> = [];
  if (refs.value_keys.length) {
    const { data, error } = await supabaseAdmin
      .from('country_legal_values')
      .select('id, value_key, country_code, status')
      .eq('country_code', country)
      .in('value_key', refs.value_keys);
    if (error) throw error;
    legalValuesByKey = (data ?? []) as typeof legalValuesByKey;
  }

  const legalValueById = new Map<string, (typeof legalValuesByKey)[number]>();
  for (const row of [...legalValuesByKey, ...legalValuesById]) legalValueById.set(row.id, row);

  const facts: TaxKnowledgeProposalCatalogFact[] = [];
  if (refs.fact_keys.length) {
    const { data: definitions, error: definitionError } = await supabaseAdmin
      .from('tax_fact_definitions')
      .select('id, fact_key, country_code, status')
      .in('fact_key', refs.fact_keys)
      .or(`country_code.is.null,country_code.eq.${country}`);
    if (definitionError) throw definitionError;
    const definitionRows = (definitions ?? []) as Array<{
      id: string;
      fact_key: string;
      country_code: string | null;
      status: string;
    }>;
    const definitionIds = definitionRows.map((row) => row.id);
    let versions: Array<{
      id: string;
      tax_fact_definition_id: string;
      status: string;
      value_type: string;
      version_no: number;
    }> = [];
    if (definitionIds.length) {
      const { data: versionRows, error: versionError } = await supabaseAdmin
        .from('tax_fact_definition_versions')
        .select('id, tax_fact_definition_id, status, value_type, version_no')
        .in('tax_fact_definition_id', definitionIds)
        .neq('status', 'retired');
      if (versionError) throw versionError;
      versions = (versionRows ?? []) as typeof versions;
    }
    const chosenVersion = new Map<string, (typeof versions)[number]>();
    for (const version of versions) {
      const current = chosenVersion.get(version.tax_fact_definition_id);
      if (!current) {
        chosenVersion.set(version.tax_fact_definition_id, version);
        continue;
      }
      if (current.status !== 'active' && version.status === 'active') {
        chosenVersion.set(version.tax_fact_definition_id, version);
        continue;
      }
      if (current.status === version.status && version.version_no > current.version_no) {
        chosenVersion.set(version.tax_fact_definition_id, version);
      }
    }
    const versionIds = [...chosenVersion.values()].map((row) => row.id);
    const enumCodes = new Map<string, string[]>();
    if (versionIds.length) {
      const { data: enumRows, error: enumError } = await supabaseAdmin
        .from('tax_fact_enum_options')
        .select('tax_fact_definition_version_id, code')
        .in('tax_fact_definition_version_id', versionIds);
      if (enumError) throw enumError;
      for (const row of enumRows ?? []) {
        const versionId = asString((row as { tax_fact_definition_version_id: string }).tax_fact_definition_version_id);
        const list = enumCodes.get(versionId) ?? [];
        list.push(asString((row as { code: string }).code));
        enumCodes.set(versionId, list);
      }
    }
    for (const definition of definitionRows) {
      const version = chosenVersion.get(definition.id);
      facts.push({
        id: definition.id,
        fact_key: definition.fact_key,
        country_code: asNullableString(definition.country_code),
        status: definition.status,
        value_type: version?.value_type ?? null,
        enum_codes: version ? enumCodes.get(version.id) ?? [] : [],
      });
    }
  }

  return {
    legal_nodes: legalNodes.map((row) => ({
      id: asString(row.id),
      country_code: asString(row.country_code),
      tax_source_id: asString(row.tax_source_id),
    })),
    legal_node_kinds: legalNodeKinds.map((row) => ({
      id: asString(row.id),
      country_code: asString(row.country_code),
    })),
    tax_rules: taxRules.map((row) => ({
      id: asString(row.id),
      country_code: asString(row.country_code),
    })),
    tax_rule_versions: taxRuleVersions.map((row) => ({
      id: asString(row.id),
      country_code: asString(row.country_code),
      tax_rule_id: asString(row.tax_rule_id),
    })),
    tax_sources: taxSourcesById.map((row) => ({
      id: asString(row.id),
      country_code: asString(row.country_code),
    })),
    facts,
    legal_values: [...legalValueById.values()],
  };
}

export async function validateTaxKnowledgeProposalV1AgainstStore(input: {
  proposal_json: unknown;
  context: TaxKnowledgeProposalValidationContext;
}): Promise<TaxKnowledgeProposalV1ValidationResult> {
  const catalog = await loadTaxKnowledgeProposalValidationCatalog(
    input.context.country_code,
    input.proposal_json,
    input.context.tax_source_id,
  );
  return validateTaxKnowledgeProposalV1({
    proposal_json: input.proposal_json,
    context: input.context,
    catalog,
  });
}
