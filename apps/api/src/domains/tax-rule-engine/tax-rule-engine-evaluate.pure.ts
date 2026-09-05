import {
  evaluateAppliesIf,
  evaluateDoesNotApplyIf,
  type TaxRuleEnginePredicateResult,
} from './tax-rule-engine-predicate.pure.js';
import {
  TAX_RULE_ENGINE_AGGREGATE_KEY,
  isTaxRuleEngineBlockingType,
  isTaxRuleEngineTraceType,
  type TaxRuleEngineBlocking,
  type TaxRuleEngineBlockingEffect,
  type TaxRuleEngineCandidate,
  type TaxRuleEngineClassification,
  type TaxRuleEngineClassificationReason,
  type TaxRuleEngineEvaluatedRule,
  type TaxRuleEngineEvaluationAggregate,
  type TaxRuleEngineFacts,
  type TaxRuleEngineLegalValueBinding,
  type TaxRuleEngineRelationshipEdge,
  type TaxRuleEngineRelationshipTrace,
  type TaxRuleEngineSourcePin,
} from './tax-rule-engine.types.js';

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function compareRules(a: TaxRuleEngineEvaluatedRule, b: TaxRuleEngineEvaluatedRule): number {
  const byCode = a.rule_code.localeCompare(b.rule_code);
  if (byCode !== 0) return byCode;
  if (a.version_no !== b.version_no) return a.version_no - b.version_no;
  return a.tax_rule_version_id.localeCompare(b.tax_rule_version_id);
}

function sortSources(sources: TaxRuleEngineSourcePin[]): TaxRuleEngineSourcePin[] {
  return [...sources].sort((a, b) => {
    const byCode = a.source_code.localeCompare(b.source_code);
    if (byCode !== 0) return byCode;
    const byLocator = (a.locator ?? '').localeCompare(b.locator ?? '');
    if (byLocator !== 0) return byLocator;
    return a.tax_rule_version_source_id.localeCompare(b.tax_rule_version_source_id);
  });
}

function sortBindings(bindings: TaxRuleEngineLegalValueBinding[]): TaxRuleEngineLegalValueBinding[] {
  return [...bindings].sort((a, b) => {
    const byKey = a.value_key.localeCompare(b.value_key);
    if (byKey !== 0) return byKey;
    return a.legal_value_id.localeCompare(b.legal_value_id);
  });
}

function statementOf(payload: Record<string, unknown>): string | null {
  return typeof payload.statement === 'string' ? payload.statement : null;
}

function classifyFromPredicates(
  exclude: TaxRuleEnginePredicateResult,
  applies: TaxRuleEnginePredicateResult,
): { classification: TaxRuleEngineClassification; reason: TaxRuleEngineClassificationReason; missing_facts: string[] } {
  if (exclude.kind === 'unsupported') {
    return { classification: 'undetermined', reason: 'predicate_unsupported', missing_facts: [] };
  }
  if (exclude.kind === 'missing') {
    return { classification: 'undetermined', reason: 'missing_facts', missing_facts: exclude.missing_facts };
  }
  if (exclude.kind === 'true') {
    return { classification: 'not_applicable', reason: 'does_not_apply_if_true', missing_facts: [] };
  }

  if (applies.kind === 'unsupported') {
    return { classification: 'undetermined', reason: 'predicate_unsupported', missing_facts: [] };
  }
  if (applies.kind === 'missing') {
    return { classification: 'undetermined', reason: 'missing_facts', missing_facts: applies.missing_facts };
  }
  if (applies.kind === 'false') {
    return { classification: 'not_applicable', reason: 'applies_if_false', missing_facts: [] };
  }
  return { classification: 'applicable', reason: 'applies_if_true', missing_facts: [] };
}

function classifyCandidate(
  candidate: TaxRuleEngineCandidate,
  facts: TaxRuleEngineFacts,
): TaxRuleEngineEvaluatedRule {
  const exclude = evaluateDoesNotApplyIf(candidate.payload_json.does_not_apply_if, facts);
  const applies = evaluateAppliesIf(candidate.payload_json.applies_if, facts);
  const classified = classifyFromPredicates(exclude, applies);
  return {
    tax_rule_id: candidate.tax_rule_id,
    rule_code: candidate.rule_code,
    tax_rule_version_id: candidate.tax_rule_version_id,
    version_no: candidate.version_no,
    payload_checksum: candidate.payload_checksum,
    statement: statementOf(candidate.payload_json),
    classification: classified.classification,
    classification_reason: classified.reason,
    missing_facts: uniqueSorted(classified.missing_facts),
    sources: sortSources(candidate.sources),
    legal_value_bindings: sortBindings(candidate.legal_value_bindings),
  };
}

function blockingEffect(
  relationshipType: TaxRuleEngineBlocking['relationship_type'],
): TaxRuleEngineBlockingEffect {
  switch (relationshipType) {
    case 'depends_on':
      return 'unmet_dependency';
    case 'conflicts_with':
      return 'conflict';
    case 'exception_to':
      return 'exception';
    case 'overrides':
      return 'override';
  }
}

function shouldBlock(
  relationshipType: TaxRuleEngineBlocking['relationship_type'],
  from: TaxRuleEngineClassification,
  to: TaxRuleEngineClassification,
): boolean {
  if (relationshipType === 'depends_on') {
    return from === 'applicable' && to !== 'applicable';
  }
  return from === 'applicable' && to === 'applicable';
}

function overlayRelationships(
  classifiedByVersionId: Map<string, TaxRuleEngineClassification>,
  relationships: TaxRuleEngineRelationshipEdge[],
): { blocking: TaxRuleEngineBlocking[]; relationship_trace: TaxRuleEngineRelationshipTrace[] } {
  const blocking: TaxRuleEngineBlocking[] = [];
  const relationshipTrace: TaxRuleEngineRelationshipTrace[] = [];

  for (const edge of relationships) {
    if (edge.status !== 'active') continue;
    if (!classifiedByVersionId.has(edge.from_tax_rule_version_id)) continue;
    if (!classifiedByVersionId.has(edge.to_tax_rule_version_id)) continue;

    if (isTaxRuleEngineTraceType(edge.relationship_type)) {
      relationshipTrace.push({
        relationship_id: edge.id,
        relationship_type: edge.relationship_type,
        from_tax_rule_version_id: edge.from_tax_rule_version_id,
        to_tax_rule_version_id: edge.to_tax_rule_version_id,
      });
      continue;
    }

    if (!isTaxRuleEngineBlockingType(edge.relationship_type)) continue;
    const from = classifiedByVersionId.get(edge.from_tax_rule_version_id);
    const to = classifiedByVersionId.get(edge.to_tax_rule_version_id);
    if (!from || !to) continue;
    if (!shouldBlock(edge.relationship_type, from, to)) continue;

    blocking.push({
      relationship_id: edge.id,
      relationship_type: edge.relationship_type,
      effect: blockingEffect(edge.relationship_type),
      from_tax_rule_version_id: edge.from_tax_rule_version_id,
      to_tax_rule_version_id: edge.to_tax_rule_version_id,
    });
  }

  blocking.sort((a, b) => a.relationship_id.localeCompare(b.relationship_id));
  relationshipTrace.sort((a, b) => a.relationship_id.localeCompare(b.relationship_id));
  return { blocking, relationship_trace: relationshipTrace };
}

export function evaluateTaxRules(input: {
  country_code: string;
  as_of: string;
  facts: TaxRuleEngineFacts;
  candidates: TaxRuleEngineCandidate[];
  relationships: TaxRuleEngineRelationshipEdge[];
}): TaxRuleEngineEvaluationAggregate {
  const sameCountry = input.candidates.filter((row) => row.country_code === input.country_code);
  const evaluated = sameCountry.map((row) => classifyCandidate(row, input.facts));
  evaluated.sort(compareRules);

  const applicable = evaluated.filter((row) => row.classification === 'applicable');
  const notApplicable = evaluated.filter((row) => row.classification === 'not_applicable');
  const undetermined = evaluated.filter((row) => row.classification === 'undetermined');

  const classifiedByVersionId = new Map(
    evaluated.map((row) => [row.tax_rule_version_id, row.classification] as const),
  );
  const overlay = overlayRelationships(classifiedByVersionId, input.relationships);

  return {
    aggregate_key: TAX_RULE_ENGINE_AGGREGATE_KEY,
    country_code: input.country_code,
    as_of: input.as_of,
    evaluated_version_ids: uniqueSorted(evaluated.map((row) => row.tax_rule_version_id)),
    applicable,
    not_applicable: notApplicable,
    undetermined,
    missing_facts: uniqueSorted(undetermined.flatMap((row) => row.missing_facts)),
    blocking: overlay.blocking,
    relationship_trace: overlay.relationship_trace,
  };
}
