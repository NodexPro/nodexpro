import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { assertCountryExists } from '../country-pack/country.service.js';
import { evaluateTaxRules } from './tax-rule-engine-evaluate.pure.js';
import {
  versionInEffectiveWindow,
  type TaxRuleEngineCandidate,
  type TaxRuleEngineEvaluateInput,
  type TaxRuleEngineEvaluationAggregate,
  type TaxRuleEngineLegalValueBinding,
  type TaxRuleEngineRelationshipEdge,
  type TaxRuleEngineSourcePin,
  type TaxRuleEngineUnresolvedLegalReference,
} from './tax-rule-engine.types.js';
import { isExpectedPreK3cSchemaAbsence } from '../tax-knowledge/tax-knowledge-unresolved.pure.js';

const VERSION_SELECT =
  'id, tax_rule_id, country_code, version_no, status, effective_from, effective_to, payload_json, payload_checksum';
const RULE_SELECT = 'id, country_code, rule_code';
const CITATION_SELECT = 'id, tax_rule_version_id, tax_source_id, locator, country_code';
const SOURCE_SELECT = 'id, country_code, source_code, title, provenance_type';
const BINDING_SELECT = 'id, tax_rule_version_id, legal_value_id, country_code';
const LEGAL_VALUE_SELECT = 'id, value_key, label';
const RELATIONSHIP_SELECT =
  'id, from_tax_rule_version_id, to_tax_rule_version_id, relationship_type, status, country_code';
const RELATIONSHIP_SELECT_K3C = `${RELATIONSHIP_SELECT}, activation_critical`;
const UNRESOLVED_SELECT =
  'id, from_tax_rule_version_id, relationship_intent, activation_critical, cited_title, cited_law_name, cited_instrument_kind, cited_provision_number, locator_text, status, country_code';

function asRecord(row: unknown): Record<string, unknown> {
  return row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
}

function asString(row: Record<string, unknown>, field: string): string {
  return String(row[field] ?? '');
}

function payloadObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function loadActiveVersions(countryCode: string, asOf: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabaseAdmin
    .from('tax_rule_versions')
    .select(VERSION_SELECT)
    .eq('country_code', countryCode)
    .eq('status', 'active')
    .lte('effective_from', asOf);
  if (error) throw error;

  return (data ?? [])
    .map((row) => asRecord(row))
    .filter((row) => {
      if (asString(row, 'country_code') !== countryCode) return false;
      if (asString(row, 'status') !== 'active') return false;
      const effectiveTo = row.effective_to == null ? null : String(row.effective_to);
      return versionInEffectiveWindow(asString(row, 'effective_from'), effectiveTo, asOf);
    });
}

export async function buildTaxRuleEngineEvaluationAggregate(
  ctx: RequestContext,
  input: TaxRuleEngineEvaluateInput,
): Promise<TaxRuleEngineEvaluationAggregate> {
  assertPlatformOwner(ctx);
  await assertCountryExists(input.country_code);

  const versions = await loadActiveVersions(input.country_code, input.as_of);
  const versionIds = versions.map((row) => asString(row, 'id')).filter(Boolean);
  const ruleIds = [...new Set(versions.map((row) => asString(row, 'tax_rule_id')).filter(Boolean))];

  if (versionIds.length === 0) {
    return evaluateTaxRules({
      country_code: input.country_code,
      as_of: input.as_of,
      facts: input.facts,
      candidates: [],
      relationships: [],
    });
  }

  const [ruleResult, citationResult, bindingResult, relationshipResult, unresolvedResult] = await Promise.all([
    supabaseAdmin.from('tax_rules').select(RULE_SELECT).eq('country_code', input.country_code).in('id', ruleIds),
    supabaseAdmin
      .from('tax_rule_version_sources')
      .select(CITATION_SELECT)
      .eq('country_code', input.country_code)
      .in('tax_rule_version_id', versionIds),
    supabaseAdmin
      .from('tax_rule_version_legal_values')
      .select(BINDING_SELECT)
      .eq('country_code', input.country_code)
      .in('tax_rule_version_id', versionIds),
    supabaseAdmin
      .from('tax_rule_relationships')
      .select(RELATIONSHIP_SELECT_K3C)
      .eq('country_code', input.country_code)
      .eq('status', 'active'),
    supabaseAdmin
      .from('tax_rule_unresolved_legal_references')
      .select(UNRESOLVED_SELECT)
      .eq('country_code', input.country_code)
      .eq('status', 'open')
      .in('from_tax_rule_version_id', versionIds),
  ]);
  if (ruleResult.error) throw ruleResult.error;
  if (citationResult.error) throw citationResult.error;
  if (bindingResult.error) throw bindingResult.error;
  let relationshipRows = relationshipResult.data;
  if (relationshipResult.error) {
    if (!isExpectedPreK3cSchemaAbsence(relationshipResult.error, 'undefined_column')) {
      throw relationshipResult.error;
    }
    const retry = await supabaseAdmin
      .from('tax_rule_relationships')
      .select(RELATIONSHIP_SELECT)
      .eq('country_code', input.country_code)
      .eq('status', 'active');
    if (retry.error) throw retry.error;
    relationshipRows = retry.data;
  }
  if (unresolvedResult.error && !isExpectedPreK3cSchemaAbsence(unresolvedResult.error, 'undefined_table')) {
    throw unresolvedResult.error;
  }

  const ruleById = new Map<string, { rule_code: string }>();
  for (const row of ruleResult.data ?? []) {
    const mapped = asRecord(row);
    if (asString(mapped, 'country_code') !== input.country_code) continue;
    ruleById.set(asString(mapped, 'id'), { rule_code: asString(mapped, 'rule_code') });
  }

  const citations = (citationResult.data ?? [])
    .map((row) => asRecord(row))
    .filter(
      (row) =>
        asString(row, 'country_code') === input.country_code &&
        versionIds.includes(asString(row, 'tax_rule_version_id')),
    );
  const sourceIds = [...new Set(citations.map((row) => asString(row, 'tax_source_id')).filter(Boolean))];
  const sourceById = new Map<string, { source_code: string; title: string; provenance_type: string }>();
  if (sourceIds.length) {
    const sources = await supabaseAdmin
      .from('tax_sources')
      .select(SOURCE_SELECT)
      .eq('country_code', input.country_code)
      .in('id', sourceIds);
    if (sources.error) throw sources.error;
    for (const row of sources.data ?? []) {
      const mapped = asRecord(row);
      if (asString(mapped, 'country_code') !== input.country_code) continue;
      sourceById.set(asString(mapped, 'id'), {
        source_code: asString(mapped, 'source_code'),
        title: asString(mapped, 'title'),
        provenance_type: asString(mapped, 'provenance_type'),
      });
    }
  }

  const sourcesByVersion = new Map<string, TaxRuleEngineSourcePin[]>();
  for (const row of citations) {
    const versionId = asString(row, 'tax_rule_version_id');
    const sourceId = asString(row, 'tax_source_id');
    const source = sourceById.get(sourceId);
    const list = sourcesByVersion.get(versionId) ?? [];
    list.push({
      tax_rule_version_source_id: asString(row, 'id'),
      tax_source_id: sourceId,
      source_code: source?.source_code ?? '',
      title: source?.title ?? '',
      provenance_type: source?.provenance_type ?? '',
      locator: row.locator == null ? null : String(row.locator),
    });
    sourcesByVersion.set(versionId, list);
  }

  const bindings = (bindingResult.data ?? [])
    .map((row) => asRecord(row))
    .filter(
      (row) =>
        asString(row, 'country_code') === input.country_code &&
        versionIds.includes(asString(row, 'tax_rule_version_id')),
    );
  const legalValueIds = [...new Set(bindings.map((row) => asString(row, 'legal_value_id')).filter(Boolean))];
  const legalValueById = new Map<string, { value_key: string; label: string }>();
  if (legalValueIds.length) {
    const legalValues = await supabaseAdmin
      .from('country_legal_values')
      .select(LEGAL_VALUE_SELECT)
      .eq('country_code', input.country_code)
      .in('id', legalValueIds);
    if (legalValues.error) throw legalValues.error;
    for (const row of legalValues.data ?? []) {
      const mapped = asRecord(row);
      legalValueById.set(asString(mapped, 'id'), {
        value_key: asString(mapped, 'value_key'),
        label: asString(mapped, 'label'),
      });
    }
  }

  const bindingsByVersion = new Map<string, TaxRuleEngineLegalValueBinding[]>();
  for (const row of bindings) {
    const versionId = asString(row, 'tax_rule_version_id');
    const legalValueId = asString(row, 'legal_value_id');
    const legal = legalValueById.get(legalValueId);
    const list = bindingsByVersion.get(versionId) ?? [];
    list.push({
      tax_rule_version_legal_value_id: asString(row, 'id'),
      legal_value_id: legalValueId,
      value_key: legal?.value_key ?? '',
      label: legal?.label ?? '',
    });
    bindingsByVersion.set(versionId, list);
  }

  const candidates: TaxRuleEngineCandidate[] = versions.map((row) => {
    const versionId = asString(row, 'id');
    const taxRuleId = asString(row, 'tax_rule_id');
    return {
      tax_rule_id: taxRuleId,
      rule_code: ruleById.get(taxRuleId)?.rule_code ?? '',
      tax_rule_version_id: versionId,
      country_code: asString(row, 'country_code'),
      version_no: Number(row.version_no),
      payload_json: payloadObject(row.payload_json),
      payload_checksum: asString(row, 'payload_checksum'),
      sources: sourcesByVersion.get(versionId) ?? [],
      legal_value_bindings: bindingsByVersion.get(versionId) ?? [],
    };
  });

  const versionIdSet = new Set(versionIds);
  const relationships: TaxRuleEngineRelationshipEdge[] = (relationshipRows ?? [])
    .map((row) => asRecord(row))
    .filter((row) => asString(row, 'country_code') === input.country_code)
    .filter((row) => asString(row, 'status') === 'active')
    .filter((row) => versionIdSet.has(asString(row, 'from_tax_rule_version_id')))
    .map((row) => ({
      id: asString(row, 'id'),
      from_tax_rule_version_id: asString(row, 'from_tax_rule_version_id'),
      to_tax_rule_version_id: asString(row, 'to_tax_rule_version_id'),
      relationship_type: asString(row, 'relationship_type'),
      status: asString(row, 'status'),
      activation_critical:
        row.activation_critical === true ? true : row.activation_critical === false ? false : null,
    }));

  const unresolved: TaxRuleEngineUnresolvedLegalReference[] = (unresolvedResult.data ?? [])
    .map((row) => asRecord(row))
    .filter((row) => asString(row, 'country_code') === input.country_code)
    .filter((row) => asString(row, 'status') === 'open')
    .filter((row) => versionIdSet.has(asString(row, 'from_tax_rule_version_id')))
    .map((row) => ({
      id: asString(row, 'id'),
      from_tax_rule_version_id: asString(row, 'from_tax_rule_version_id'),
      relationship_intent: asString(row, 'relationship_intent'),
      activation_critical:
        row.activation_critical === true ? true : row.activation_critical === false ? false : null,
      cited_title: row.cited_title == null ? null : String(row.cited_title),
      cited_law_name: row.cited_law_name == null ? null : String(row.cited_law_name),
      cited_instrument_kind: asString(row, 'cited_instrument_kind'),
      cited_provision_number: row.cited_provision_number == null ? null : String(row.cited_provision_number),
      locator_text: asString(row, 'locator_text'),
      status: asString(row, 'status'),
    }));

  return evaluateTaxRules({
    country_code: input.country_code,
    as_of: input.as_of,
    facts: input.facts,
    candidates,
    relationships,
    unresolved_legal_references: unresolved,
  });
}
