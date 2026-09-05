import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTaxRules } from '../../src/domains/tax-rule-engine/tax-rule-engine-evaluate.pure.js';
import type {
  TaxRuleEngineCandidate,
  TaxRuleEngineRelationshipEdge,
  TaxRuleEngineUnresolvedLegalReference,
} from '../../src/domains/tax-rule-engine/tax-rule-engine.types.js';

function candidate(
  overrides: Partial<TaxRuleEngineCandidate> & Pick<TaxRuleEngineCandidate, 'tax_rule_version_id' | 'rule_code'>,
): TaxRuleEngineCandidate {
  return {
    tax_rule_id: overrides.tax_rule_id ?? `rule-${overrides.rule_code}`,
    rule_code: overrides.rule_code,
    tax_rule_version_id: overrides.tax_rule_version_id,
    country_code: overrides.country_code ?? 'IL',
    version_no: overrides.version_no ?? 1,
    payload_json: overrides.payload_json ?? { statement: overrides.rule_code, applies_if: null, does_not_apply_if: null },
    payload_checksum: overrides.payload_checksum ?? `checksum-${overrides.tax_rule_version_id}`,
    sources: overrides.sources ?? [],
    legal_value_bindings: overrides.legal_value_bindings ?? [],
  };
}

function edge(
  id: string,
  type: string,
  from: string,
  to: string,
  activationCritical: boolean | null = null,
): TaxRuleEngineRelationshipEdge {
  return {
    id,
    relationship_type: type,
    from_tax_rule_version_id: from,
    to_tax_rule_version_id: to,
    status: 'active',
    activation_critical: activationCritical,
  };
}

function unresolved(
  overrides: Partial<TaxRuleEngineUnresolvedLegalReference> & Pick<TaxRuleEngineUnresolvedLegalReference, 'id' | 'from_tax_rule_version_id' | 'relationship_intent'>,
): TaxRuleEngineUnresolvedLegalReference {
  return {
    id: overrides.id,
    from_tax_rule_version_id: overrides.from_tax_rule_version_id,
    relationship_intent: overrides.relationship_intent,
    activation_critical: overrides.activation_critical ?? null,
    cited_title: overrides.cited_title ?? null,
    cited_law_name: overrides.cited_law_name ?? 'פקודת מס הכנסה',
    cited_instrument_kind: overrides.cited_instrument_kind ?? 'regulation',
    cited_provision_number: overrides.cited_provision_number ?? '3',
    locator_text: overrides.locator_text ?? 'see תקנה 3',
    status: overrides.status ?? 'open',
  };
}

const applicable = candidate({
  tax_rule_version_id: 'v-from',
  rule_code: 'FROM',
  payload_json: { applies_if: { fact: 'residency_status', op: 'eq', value: 'resident' } },
});
const companionMissing = candidate({
  tax_rule_version_id: 'v-to',
  rule_code: 'TO',
  payload_json: { applies_if: { fact: 'residency_status', op: 'eq', value: 'non_resident' } },
});

test('TAX-K3C pure: applies_with unmet companion does not reclassify', () => {
  const result = evaluateTaxRules({
    country_code: 'IL',
    as_of: '2026-06-01',
    facts: { residency_status: 'resident' },
    candidates: [applicable, companionMissing],
    relationships: [edge('rel-aw', 'applies_with', 'v-from', 'v-to')],
  });
  assert.equal(result.applicable.map((row) => row.tax_rule_version_id).includes('v-from'), true);
  assert.equal(result.blocking.length, 0);
  assert.equal(result.blocking_linked_requirements[0]?.effect, 'unmet_companion');
  assert.equal(result.linked_rules[0]?.relationship_type, 'applies_with');
});

test('TAX-K3C pure: calculation_basis is calculation_links only', () => {
  const result = evaluateTaxRules({
    country_code: 'IL',
    as_of: '2026-06-01',
    facts: { residency_status: 'resident' },
    candidates: [applicable, companionMissing],
    relationships: [edge('rel-cb', 'calculation_basis', 'v-from', 'v-to')],
  });
  assert.equal(result.calculation_links[0]?.relationship_id, 'rel-cb');
  assert.equal(result.blocking_linked_requirements.length, 0);
  assert.equal(result.applicable[0]?.tax_rule_version_id, 'v-from');
});

test('TAX-K3C pure: procedural true unmet vs false guidance', () => {
  const mandatory = evaluateTaxRules({
    country_code: 'IL',
    as_of: '2026-06-01',
    facts: { residency_status: 'resident' },
    candidates: [applicable, companionMissing],
    relationships: [edge('rel-pt', 'procedural_requirement', 'v-from', 'v-to', true)],
  });
  assert.equal(mandatory.blocking_linked_requirements[0]?.effect, 'unmet_procedure');
  assert.equal(mandatory.linked_rules.length, 0);
  assert.equal(mandatory.applicable[0]?.classification, 'applicable');

  const guidance = evaluateTaxRules({
    country_code: 'IL',
    as_of: '2026-06-01',
    facts: { residency_status: 'resident' },
    candidates: [applicable, companionMissing],
    relationships: [edge('rel-pf', 'procedural_requirement', 'v-from', 'v-to', false)],
  });
  assert.equal(guidance.linked_rules[0]?.effect, 'procedural_guidance');
  assert.equal(guidance.blocking_linked_requirements.length, 0);
});

test('TAX-K3C pure: open procedural false and conflicts_with stay unresolved only', () => {
  const result = evaluateTaxRules({
    country_code: 'IL',
    as_of: '2026-06-01',
    facts: { residency_status: 'resident' },
    candidates: [applicable],
    relationships: [],
    unresolved_legal_references: [
      unresolved({
        id: 'u-proc',
        from_tax_rule_version_id: 'v-from',
        relationship_intent: 'procedural_requirement',
        activation_critical: false,
      }),
      unresolved({
        id: 'u-conf',
        from_tax_rule_version_id: 'v-from',
        relationship_intent: 'conflicts_with',
        locator_text: 'conflicts with missing',
      }),
    ],
  });
  assert.deepEqual(
    result.unresolved_legal_references.map((row) => row.id).sort(),
    ['u-conf', 'u-proc'],
  );
  assert.equal(result.blocking.length, 0);
  assert.equal(result.blocking_linked_requirements.length, 0);
  assert.equal(result.undetermined.length, 0);
  assert.equal(result.applicable[0]?.tax_rule_version_id, 'v-from');
});

test('TAX-K3C pure: discarded unresolved is omitted; data-error open depends_on is exposed', () => {
  const result = evaluateTaxRules({
    country_code: 'IL',
    as_of: '2026-06-01',
    facts: { residency_status: 'resident' },
    candidates: [applicable],
    relationships: [edge('rel-dep', 'depends_on', 'v-from', 'v-missing')],
    unresolved_legal_references: [
      unresolved({
        id: 'u-disc',
        from_tax_rule_version_id: 'v-from',
        relationship_intent: 'elaborates',
        status: 'discarded',
      }),
      unresolved({
        id: 'u-dep',
        from_tax_rule_version_id: 'v-from',
        relationship_intent: 'depends_on',
      }),
    ],
  });
  assert.equal(result.unresolved_legal_references.map((row) => row.id).join(), 'u-dep');
  assert.equal(result.blocking_linked_requirements.some((row) => row.effect === 'unresolved_dependency'), true);
  assert.equal(result.applicable[0]?.classification, 'applicable');
});

test('TAX-K3C pure: K3A blocking/trace still hold', () => {
  const other = candidate({
    tax_rule_version_id: 'v-other',
    rule_code: 'OTHER',
  });
  const result = evaluateTaxRules({
    country_code: 'IL',
    as_of: '2026-06-01',
    facts: { residency_status: 'resident' },
    candidates: [applicable, other],
    relationships: [
      edge('rel-conf', 'conflicts_with', 'v-from', 'v-other'),
      edge('rel-el', 'elaborates', 'v-from', 'v-other'),
    ],
  });
  assert.equal(result.blocking[0]?.effect, 'conflict');
  assert.equal(result.relationship_trace[0]?.relationship_type, 'elaborates');
  assert.equal(result.applicable.length, 2);
});
