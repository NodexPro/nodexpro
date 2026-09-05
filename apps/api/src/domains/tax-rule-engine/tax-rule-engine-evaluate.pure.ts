import {
  evaluateAppliesIf,
  evaluateDoesNotApplyIf,
  type TaxRuleEnginePredicateResult,
} from './tax-rule-engine-predicate.pure.js';
import {
  EVALUATION_AS_OF_FACT,
  TAX_RULE_ENGINE_AGGREGATE_KEY,
  isTaxRuleEngineBlockingType,
  isTaxRuleEngineTraceType,
  type TaxRuleEngineBlocking,
  type TaxRuleEngineBlockingEffect,
  type TaxRuleEngineBlockingLinkedRequirement,
  type TaxRuleEngineCalculationLink,
  type TaxRuleEngineCandidate,
  type TaxRuleEngineClassification,
  type TaxRuleEngineClassificationReason,
  type TaxRuleEngineEvaluatedRule,
  type TaxRuleEngineEvaluationAggregate,
  type TaxRuleEngineFacts,
  type TaxRuleEngineLegalValueBinding,
  type TaxRuleEngineLinkedRule,
  type TaxRuleEnginePredicateReason,
  type TaxRuleEngineRelationshipEdge,
  type TaxRuleEngineRelationshipTrace,
  type TaxRuleEngineSourcePin,
  type TaxRuleEngineUnresolvedLegalReference,
} from './tax-rule-engine.types.js';
import { unresolvedRowBlocksActivation } from '../tax-knowledge/tax-knowledge-unresolved.pure.js';

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

function unsupportedReason(result: TaxRuleEnginePredicateResult): TaxRuleEngineClassificationReason {
  return result.reason === 'type_mismatch' ? 'type_mismatch' : 'predicate_unsupported';
}

function classifyFromPredicates(
  exclude: TaxRuleEnginePredicateResult,
  applies: TaxRuleEnginePredicateResult,
): {
  classification: TaxRuleEngineClassification;
  reason: TaxRuleEngineClassificationReason;
  predicate_reason: TaxRuleEnginePredicateReason | null;
  missing_facts: string[];
} {
  if (exclude.kind === 'unsupported') {
    return {
      classification: 'undetermined',
      reason: unsupportedReason(exclude),
      predicate_reason: exclude.reason ?? 'predicate_unsupported',
      missing_facts: [],
    };
  }
  if (exclude.kind === 'missing') {
    return {
      classification: 'undetermined',
      reason: 'missing_facts',
      predicate_reason: 'missing_facts',
      missing_facts: exclude.missing_facts,
    };
  }
  if (exclude.kind === 'true') {
    return {
      classification: 'not_applicable',
      reason: 'does_not_apply_if_true',
      predicate_reason: null,
      missing_facts: [],
    };
  }

  if (applies.kind === 'unsupported') {
    return {
      classification: 'undetermined',
      reason: unsupportedReason(applies),
      predicate_reason: applies.reason ?? 'predicate_unsupported',
      missing_facts: [],
    };
  }
  if (applies.kind === 'missing') {
    return {
      classification: 'undetermined',
      reason: 'missing_facts',
      predicate_reason: 'missing_facts',
      missing_facts: applies.missing_facts,
    };
  }
  if (applies.kind === 'false') {
    return {
      classification: 'not_applicable',
      reason: 'applies_if_false',
      predicate_reason: null,
      missing_facts: [],
    };
  }
  return { classification: 'applicable', reason: 'applies_if_true', predicate_reason: null, missing_facts: [] };
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
    predicate_reason: classified.predicate_reason,
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
  unresolved: TaxRuleEngineUnresolvedLegalReference[],
): {
  blocking: TaxRuleEngineBlocking[];
  relationship_trace: TaxRuleEngineRelationshipTrace[];
  linked_rules: TaxRuleEngineLinkedRule[];
  calculation_links: TaxRuleEngineCalculationLink[];
  blocking_linked_requirements: TaxRuleEngineBlockingLinkedRequirement[];
  unresolved_legal_references: TaxRuleEngineUnresolvedLegalReference[];
} {
  const blocking: TaxRuleEngineBlocking[] = [];
  const relationshipTrace: TaxRuleEngineRelationshipTrace[] = [];
  const linkedRules: TaxRuleEngineLinkedRule[] = [];
  const calculationLinks: TaxRuleEngineCalculationLink[] = [];
  const blockingLinked: TaxRuleEngineBlockingLinkedRequirement[] = [];

  for (const edge of relationships) {
    if (edge.status !== 'active') continue;
    if (!classifiedByVersionId.has(edge.from_tax_rule_version_id)) continue;

    const from = classifiedByVersionId.get(edge.from_tax_rule_version_id);
    const to = classifiedByVersionId.get(edge.to_tax_rule_version_id);
    const toApplicable = to === 'applicable';

    if (edge.relationship_type === 'applies_with') {
      linkedRules.push({
        relationship_id: edge.id,
        relationship_type: 'applies_with',
        from_tax_rule_version_id: edge.from_tax_rule_version_id,
        to_tax_rule_version_id: edge.to_tax_rule_version_id,
        effect: 'companion',
      });
      if (from === 'applicable' && to !== 'applicable') {
        blockingLinked.push({
          relationship_id: edge.id,
          unresolved_legal_reference_id: null,
          relationship_type: 'applies_with',
          effect: 'unmet_companion',
          from_tax_rule_version_id: edge.from_tax_rule_version_id,
          to_tax_rule_version_id: edge.to_tax_rule_version_id,
        });
      }
      continue;
    }

    if (edge.relationship_type === 'calculation_basis') {
      calculationLinks.push({
        relationship_id: edge.id,
        from_tax_rule_version_id: edge.from_tax_rule_version_id,
        to_tax_rule_version_id: edge.to_tax_rule_version_id,
        relationship_type: 'calculation_basis',
      });
      continue;
    }

    if (edge.relationship_type === 'procedural_requirement') {
      if (edge.activation_critical === false) {
        linkedRules.push({
          relationship_id: edge.id,
          relationship_type: 'procedural_requirement',
          from_tax_rule_version_id: edge.from_tax_rule_version_id,
          to_tax_rule_version_id: edge.to_tax_rule_version_id,
          effect: 'procedural_guidance',
        });
      } else if (from === 'applicable' && !toApplicable) {
        blockingLinked.push({
          relationship_id: edge.id,
          unresolved_legal_reference_id: null,
          relationship_type: 'procedural_requirement',
          effect: 'unmet_procedure',
          from_tax_rule_version_id: edge.from_tax_rule_version_id,
          to_tax_rule_version_id: edge.to_tax_rule_version_id,
        });
      }
      continue;
    }

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

  const exposedUnresolved = unresolved
    .filter((row) => row.status === 'open' && classifiedByVersionId.has(row.from_tax_rule_version_id))
    .map((row) => ({ ...row }))
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const row of exposedUnresolved) {
    if (
      unresolvedRowBlocksActivation({
        status: row.status,
        relationship_intent: row.relationship_intent,
        activation_critical: row.activation_critical,
      })
    ) {
      blockingLinked.push({
        relationship_id: null,
        unresolved_legal_reference_id: row.id,
        relationship_type: row.relationship_intent,
        effect:
          row.relationship_intent === 'procedural_requirement'
            ? 'unmet_procedure'
            : row.relationship_intent === 'applies_with'
              ? 'unmet_companion'
              : 'unresolved_dependency',
        from_tax_rule_version_id: row.from_tax_rule_version_id,
        to_tax_rule_version_id: null,
      });
    }
  }

  blocking.sort((a, b) => a.relationship_id.localeCompare(b.relationship_id));
  relationshipTrace.sort((a, b) => a.relationship_id.localeCompare(b.relationship_id));
  linkedRules.sort((a, b) => a.relationship_id.localeCompare(b.relationship_id));
  calculationLinks.sort((a, b) => a.relationship_id.localeCompare(b.relationship_id));
  blockingLinked.sort((a, b) => {
    const left = a.relationship_id ?? a.unresolved_legal_reference_id ?? '';
    const right = b.relationship_id ?? b.unresolved_legal_reference_id ?? '';
    return left.localeCompare(right);
  });
  return {
    blocking,
    relationship_trace: relationshipTrace,
    linked_rules: linkedRules,
    calculation_links: calculationLinks,
    blocking_linked_requirements: blockingLinked,
    unresolved_legal_references: exposedUnresolved,
  };
}

export function evaluateTaxRules(input: {
  country_code: string;
  as_of: string;
  facts: TaxRuleEngineFacts;
  candidates: TaxRuleEngineCandidate[];
  relationships: TaxRuleEngineRelationshipEdge[];
  unresolved_legal_references?: TaxRuleEngineUnresolvedLegalReference[];
}): TaxRuleEngineEvaluationAggregate {
  const facts: TaxRuleEngineFacts = {
    ...input.facts,
    [EVALUATION_AS_OF_FACT]: input.as_of,
  };
  const sameCountry = input.candidates.filter((row) => row.country_code === input.country_code);
  const evaluated = sameCountry.map((row) => classifyCandidate(row, facts));
  evaluated.sort(compareRules);

  const applicable = evaluated.filter((row) => row.classification === 'applicable');
  const notApplicable = evaluated.filter((row) => row.classification === 'not_applicable');
  const undetermined = evaluated.filter((row) => row.classification === 'undetermined');

  const classifiedByVersionId = new Map(
    evaluated.map((row) => [row.tax_rule_version_id, row.classification] as const),
  );
  const overlay = overlayRelationships(
    classifiedByVersionId,
    input.relationships,
    input.unresolved_legal_references ?? [],
  );

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
    linked_rules: overlay.linked_rules,
    unresolved_legal_references: overlay.unresolved_legal_references,
    calculation_links: overlay.calculation_links,
    blocking_linked_requirements: overlay.blocking_linked_requirements,
  };
}
