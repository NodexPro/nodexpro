import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTaxRules } from '../../src/domains/tax-rule-engine/tax-rule-engine-evaluate.pure.js';
import {
  TAX_RULE_ENGINE_AGGREGATE_KEY,
  type TaxRuleEngineCandidate,
  type TaxRuleEngineRelationshipEdge,
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
    sources: overrides.sources ?? [
      {
        tax_rule_version_source_id: `src-row-${overrides.tax_rule_version_id}`,
        tax_source_id: `src-${overrides.tax_rule_version_id}`,
        source_code: 'LAW-1',
        title: 'Official law',
        provenance_type: 'official_law',
        locator: 'art.1',
      },
    ],
    legal_value_bindings: overrides.legal_value_bindings ?? [],
  };
}

function edge(
  id: string,
  type: string,
  from: string,
  to: string,
  status = 'active',
): TaxRuleEngineRelationshipEdge {
  return {
    id,
    relationship_type: type,
    from_tax_rule_version_id: from,
    to_tax_rule_version_id: to,
    status,
  };
}

function idsOf(rows: Array<{ tax_rule_version_id: string }>): string[] {
  return rows.map((row) => row.tax_rule_version_id);
}

test('TAX-K3A pure: classification is three-state, mutually exclusive, and sorted', () => {
  const result = evaluateTaxRules({
    country_code: 'IL',
    as_of: '2026-06-01',
    facts: { residency_status: 'resident' },
    candidates: [
      candidate({
        tax_rule_version_id: 'v-z',
        rule_code: 'Z-NULL',
        version_no: 2,
      }),
      candidate({
        tax_rule_version_id: 'v-a',
        rule_code: 'A-APPLY',
        payload_json: {
          statement: 'resident rule',
          applies_if: { fact: 'residency_status', op: 'eq', value: 'resident' },
        },
      }),
      candidate({
        tax_rule_version_id: 'v-n',
        rule_code: 'N-NOT',
        payload_json: {
          statement: 'non resident',
          applies_if: { fact: 'residency_status', op: 'eq', value: 'non_resident' },
        },
      }),
      candidate({
        tax_rule_version_id: 'v-x',
        rule_code: 'X-EXCLUDE',
        payload_json: {
          statement: 'excluded',
          does_not_apply_if: { fact: 'residency_status', op: 'eq', value: 'resident' },
        },
      }),
      candidate({
        tax_rule_version_id: 'v-m',
        rule_code: 'M-MISS',
        payload_json: {
          statement: 'needs age',
          applies_if: { fact: 'age', op: 'gte', value: 18 },
        },
      }),
      candidate({
        tax_rule_version_id: 'v-u',
        rule_code: 'U-BAD',
        payload_json: {
          statement: 'bad predicate',
          applies_if: 'always when resident',
        },
      }),
      candidate({
        tax_rule_version_id: 'v-us',
        rule_code: 'US-LEAK',
        country_code: 'US',
      }),
    ],
    relationships: [],
  });

  assert.equal(result.aggregate_key, TAX_RULE_ENGINE_AGGREGATE_KEY);
  assert.deepEqual(idsOf(result.applicable), ['v-a', 'v-z']);
  assert.deepEqual(idsOf(result.not_applicable), ['v-n', 'v-x']);
  assert.deepEqual(idsOf(result.undetermined), ['v-m', 'v-u']);
  assert.deepEqual(result.missing_facts, ['age']);
  assert.deepEqual(result.evaluated_version_ids, ['v-a', 'v-m', 'v-n', 'v-u', 'v-x', 'v-z']);
  assert.equal(result.applicable.find((row) => row.tax_rule_version_id === 'v-a')?.classification_reason, 'applies_if_true');
  assert.equal(result.not_applicable.find((row) => row.tax_rule_version_id === 'v-x')?.classification_reason, 'does_not_apply_if_true');
  assert.equal(result.not_applicable.find((row) => row.tax_rule_version_id === 'v-n')?.classification_reason, 'applies_if_false');
  assert.equal(result.undetermined.find((row) => row.tax_rule_version_id === 'v-m')?.classification_reason, 'missing_facts');
  assert.equal(result.undetermined.find((row) => row.tax_rule_version_id === 'v-u')?.classification_reason, 'predicate_unsupported');

  const allIds = [...idsOf(result.applicable), ...idsOf(result.not_applicable), ...idsOf(result.undetermined)];
  assert.equal(new Set(allIds).size, allIds.length);
  assert.ok(!allIds.includes('v-us'));
});

test('TAX-K3A pure: missing/unsupported never become not_applicable', () => {
  const result = evaluateTaxRules({
    country_code: 'IL',
    as_of: '2026-01-01',
    facts: { known: true },
    candidates: [
      candidate({
        tax_rule_version_id: 'v-miss-exclude',
        rule_code: 'EX-MISS',
        payload_json: {
          does_not_apply_if: { fact: 'unknown', op: 'eq', value: true },
          applies_if: { fact: 'known', op: 'eq', value: true },
        },
      }),
      candidate({
        tax_rule_version_id: 'v-bad-exclude',
        rule_code: 'EX-BAD',
        payload_json: {
          does_not_apply_if: { fact: 'known', op: 'matches', value: true },
        },
      }),
    ],
    relationships: [],
  });

  assert.deepEqual(result.not_applicable, []);
  assert.deepEqual(idsOf(result.undetermined), ['v-bad-exclude', 'v-miss-exclude']);
  assert.deepEqual(result.missing_facts, ['unknown']);
});

test('TAX-K3A pure: direct relationships block or trace without dropping applicable rows', () => {
  const result = evaluateTaxRules({
    country_code: 'IL',
    as_of: '2026-01-01',
    facts: { residency_status: 'resident' },
    candidates: [
      candidate({ tax_rule_version_id: 'v-base', rule_code: 'BASE' }),
      candidate({
        tax_rule_version_id: 'v-dep',
        rule_code: 'DEP',
        payload_json: { applies_if: { fact: 'residency_status', op: 'eq', value: 'resident' } },
      }),
      candidate({
        tax_rule_version_id: 'v-unmet',
        rule_code: 'UNMET',
        payload_json: { applies_if: { fact: 'residency_status', op: 'eq', value: 'resident' } },
      }),
      candidate({
        tax_rule_version_id: 'v-missing-dep',
        rule_code: 'NEED',
        payload_json: { applies_if: { fact: 'age', op: 'gte', value: 18 } },
      }),
      candidate({
        tax_rule_version_id: 'v-conflict-a',
        rule_code: 'CA',
      }),
      candidate({
        tax_rule_version_id: 'v-conflict-b',
        rule_code: 'CB',
      }),
      candidate({
        tax_rule_version_id: 'v-exc',
        rule_code: 'EXC',
      }),
      candidate({
        tax_rule_version_id: 'v-ovr',
        rule_code: 'OVR',
      }),
      candidate({
        tax_rule_version_id: 'v-alt',
        rule_code: 'ALT',
      }),
    ],
    relationships: [
      edge('rel-dep-ok', 'depends_on', 'v-dep', 'v-base'),
      edge('rel-dep-unmet', 'depends_on', 'v-unmet', 'v-missing-dep'),
      edge('rel-conflict', 'conflicts_with', 'v-conflict-a', 'v-conflict-b'),
      edge('rel-exc', 'exception_to', 'v-exc', 'v-base'),
      edge('rel-ovr', 'overrides', 'v-ovr', 'v-base'),
      edge('rel-alt', 'alternative_to', 'v-alt', 'v-base'),
      edge('rel-spec', 'special_case_of', 'v-exc', 'v-base'),
      edge('rel-elab', 'elaborates', 'v-ovr', 'v-base'),
      edge('rel-retired', 'conflicts_with', 'v-conflict-a', 'v-base', 'retired'),
      edge('rel-outside', 'depends_on', 'v-dep', 'v-not-loaded'),
    ],
  });

  assert.ok(idsOf(result.applicable).includes('v-unmet'));
  assert.ok(idsOf(result.applicable).includes('v-conflict-a'));
  assert.ok(idsOf(result.applicable).includes('v-conflict-b'));
  assert.ok(idsOf(result.applicable).includes('v-exc'));
  assert.ok(idsOf(result.applicable).includes('v-ovr'));
  assert.deepEqual(
    result.blocking.map((row) => row.relationship_id),
    ['rel-conflict', 'rel-dep-unmet', 'rel-exc', 'rel-ovr'],
  );
  assert.equal(result.blocking.find((row) => row.relationship_id === 'rel-dep-unmet')?.effect, 'unmet_dependency');
  assert.equal(result.blocking.find((row) => row.relationship_id === 'rel-conflict')?.effect, 'conflict');
  assert.equal(result.blocking.find((row) => row.relationship_id === 'rel-exc')?.effect, 'exception');
  assert.equal(result.blocking.find((row) => row.relationship_id === 'rel-ovr')?.effect, 'override');
  assert.deepEqual(
    result.relationship_trace.map((row) => row.relationship_id),
    ['rel-alt', 'rel-elab', 'rel-spec'],
  );
  assert.ok(!result.blocking.some((row) => row.relationship_id === 'rel-dep-ok'));
  assert.ok(!result.blocking.some((row) => row.relationship_id === 'rel-retired'));
  assert.ok(!result.blocking.some((row) => row.relationship_id === 'rel-outside'));
});

test('TAX-K3A pure: identical input yields identical aggregate and keeps provenance pins', () => {
  const input = {
    country_code: 'IL',
    as_of: '2026-01-01',
    facts: { residency_status: 'resident' },
    candidates: [
      candidate({
        tax_rule_version_id: 'v-1',
        rule_code: 'R1',
        legal_value_bindings: [
          {
            tax_rule_version_legal_value_id: 'bind-1',
            legal_value_id: 'lv-1',
            value_key: 'standard_points',
            label: 'Standard points',
          },
        ],
      }),
    ],
    relationships: [edge('rel-alt', 'alternative_to', 'v-1', 'v-1')],
  };

  const first = evaluateTaxRules(input);
  const second = evaluateTaxRules(input);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.applicable[0]?.tax_rule_version_id, 'v-1');
  assert.equal(first.applicable[0]?.payload_checksum, 'checksum-v-1');
  assert.equal(first.applicable[0]?.sources[0]?.tax_source_id, 'src-v-1');
  assert.equal(first.applicable[0]?.legal_value_bindings[0]?.legal_value_id, 'lv-1');
  assert.ok(!('rate' in (first.applicable[0]?.legal_value_bindings[0] ?? {})));
  assert.ok(!('amount' in (first.applicable[0]?.legal_value_bindings[0] ?? {})));
});
