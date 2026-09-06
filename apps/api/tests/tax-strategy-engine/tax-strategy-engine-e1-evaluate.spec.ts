import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateTaxStrategies,
  statusFromFindings,
} from '../../src/domains/tax-strategy-engine/tax-strategy-engine-evaluate.pure.js';
import {
  TAX_STRATEGY_ENGINE_EVALUATION_KEY,
  TAX_STRATEGY_FINDING_CODES,
  TAX_STRATEGY_FINDING_SEVERITY_BY_CODE,
  type TaxStrategyFinding,
  type TaxStrategyVersionInput,
} from '../../src/domains/tax-strategy-engine/tax-strategy-engine.types.js';
import type { TaxCalculationResultAggregate } from '../../src/domains/tax-calculation-engine/tax-calculation-engine-commands.types.js';
import type {
  TaxRuleEngineBlocking,
  TaxRuleEngineBlockingLinkedRequirement,
  TaxRuleEngineEvaluatedRule,
  TaxRuleEngineEvaluationAggregate,
  TaxRuleEngineRelationshipTrace,
  TaxRuleEngineUnresolvedLegalReference,
} from '../../src/domains/tax-rule-engine/tax-rule-engine.types.js';
import { TAX_RULE_ENGINE_AGGREGATE_KEY } from '../../src/domains/tax-rule-engine/tax-rule-engine.types.js';

function rule(
  tax_rule_version_id: string,
  classification: TaxRuleEngineEvaluatedRule['classification'],
  extras: Partial<TaxRuleEngineEvaluatedRule> = {},
): TaxRuleEngineEvaluatedRule {
  return {
    tax_rule_id: `rule-${tax_rule_version_id}`,
    rule_code: tax_rule_version_id.toUpperCase(),
    tax_rule_version_id,
    version_no: 1,
    payload_checksum: `sum-${tax_rule_version_id}`,
    statement: null,
    classification,
    classification_reason: classification === 'undetermined' ? 'missing_facts' : 'applies_if_true',
    predicate_reason: classification === 'undetermined' ? 'missing_facts' : null,
    missing_facts: extras.missing_facts ?? [],
    sources: [],
    legal_value_bindings: [],
    ...extras,
  };
}

function tre(overrides: Partial<TaxRuleEngineEvaluationAggregate> = {}): TaxRuleEngineEvaluationAggregate {
  const applicable = overrides.applicable ?? [];
  const not_applicable = overrides.not_applicable ?? [];
  const undetermined = overrides.undetermined ?? [];
  return {
    aggregate_key: TAX_RULE_ENGINE_AGGREGATE_KEY,
    country_code: 'IL',
    as_of: '2026-01-01',
    evaluated_version_ids: [...applicable, ...not_applicable, ...undetermined].map((row) => row.tax_rule_version_id),
    applicable,
    not_applicable,
    undetermined,
    missing_facts: undetermined.flatMap((row) => row.missing_facts),
    blocking: [],
    relationship_trace: [],
    linked_rules: [],
    unresolved_legal_references: [],
    calculation_links: [],
    blocking_linked_requirements: [],
    ...overrides,
  };
}

function strategy(overrides: Partial<TaxStrategyVersionInput> = {}): TaxStrategyVersionInput {
  return {
    strategy_id: 's-1',
    strategy_version_id: 'sv-1',
    strategy_code: 'S1',
    country_code: 'IL',
    required_rule_pins: [{ tax_rule_version_id: 'v-req' }],
    ...overrides,
  };
}

function calc(overrides: Partial<TaxCalculationResultAggregate> = {}): TaxCalculationResultAggregate {
  return {
    aggregate_key: 'tax_calculation_result_aggregate',
    country_code: 'IL',
    as_of: '2026-01-01',
    currency: 'ILS',
    status: 'calculated',
    definition: { calculation_definition_version_id: 'cdv-1' },
    result: { type: 'decimal', value: '10' },
    blocking: [],
    missing_inputs: [],
    rule_pins: [],
    legal_value_pins: [],
    calculation_basis_pins: [],
    unresolved_calculation_basis: [],
    trace: [],
    context_checksum: 'ctx',
    input_checksum: 'in',
    result_checksum: 'res',
    execution_checksum: 'ex',
    engine: { dialect: 'tax_calculation_k4', dialect_version: 'K4C' },
    ...overrides,
  };
}

function evaluate(opts: {
  strategies?: TaxStrategyVersionInput[];
  rule_evaluation?: TaxRuleEngineEvaluationAggregate;
  calculations?: TaxCalculationResultAggregate[];
}) {
  return evaluateTaxStrategies({
    country_code: 'IL',
    as_of: '2026-01-01',
    strategies: opts.strategies ?? [strategy()],
    rule_evaluation: opts.rule_evaluation ?? tre({ applicable: [rule('v-req', 'applicable')] }),
    calculations: opts.calculations,
  });
}

function codes(findings: TaxStrategyFinding[]): string[] {
  return findings.map((row) => row.code);
}

function memberOf(result: ReturnType<typeof evaluate>, strategyVersionId = 'sv-1') {
  const member = result.members.find((row) => row.strategy_version_id === strategyVersionId);
  assert.ok(member, `missing member ${strategyVersionId}`);
  return member;
}

test('TAX-E1 1: required applicable → available', () => {
  const result = evaluate({});
  const member = memberOf(result);
  assert.equal(member.status, 'available');
  assert.deepEqual(codes(member.findings), []);
  assert.equal(result.evaluation_key, TAX_STRATEGY_ENGINE_EVALUATION_KEY);
});

test('TAX-E1 2: required not_applicable → unavailable', () => {
  const member = memberOf(
    evaluate({ rule_evaluation: tre({ not_applicable: [rule('v-req', 'not_applicable')] }) }),
  );
  assert.equal(member.status, 'unavailable');
  assert.deepEqual(codes(member.findings), ['required_rule_not_applicable']);
  assert.equal(member.findings[0]?.tax_rule_version_id, 'v-req');
  assert.equal(member.findings[0]?.severity, 'closes');
});

test('TAX-E1 3: required undetermined → unevaluable + missing_facts', () => {
  const member = memberOf(
    evaluate({
      rule_evaluation: tre({
        undetermined: [rule('v-req', 'undetermined', { missing_facts: ['residency'] })],
      }),
    }),
  );
  assert.equal(member.status, 'unevaluable');
  assert.deepEqual(codes(member.findings), ['missing_facts']);
  assert.deepEqual(member.findings[0]?.missing_facts, ['residency']);
});

test('TAX-E1 4: required absent from TRE → unevaluable + required_rule_not_evaluated', () => {
  const member = memberOf(evaluate({ rule_evaluation: tre() }));
  assert.equal(member.status, 'unevaluable');
  assert.deepEqual(codes(member.findings), ['required_rule_not_evaluated']);
  assert.equal(member.findings[0]?.severity, 'incomplete');
});

test('TAX-E1 5: missing required + another required not_applicable → unavailable, both findings', () => {
  const member = memberOf(
    evaluate({
      strategies: [
        strategy({
          required_rule_pins: [
            { tax_rule_version_id: 'v-missing' },
            { tax_rule_version_id: 'v-no' },
          ],
        }),
      ],
      rule_evaluation: tre({ not_applicable: [rule('v-no', 'not_applicable')] }),
    }),
  );
  assert.equal(member.status, 'unavailable');
  assert.deepEqual(codes(member.findings), ['required_rule_not_applicable', 'required_rule_not_evaluated']);
});

test('TAX-E1 6: prohibited applicable → unavailable', () => {
  const member = memberOf(
    evaluate({
      strategies: [
        strategy({
          prohibited_rule_pins: [{ tax_rule_version_id: 'v-ban' }],
        }),
      ],
      rule_evaluation: tre({
        applicable: [rule('v-req', 'applicable'), rule('v-ban', 'applicable')],
      }),
    }),
  );
  assert.equal(member.status, 'unavailable');
  assert.deepEqual(codes(member.findings), ['prohibited_rule_applicable']);
});

function overlayCase(
  effect: TaxRuleEngineBlocking['effect'],
  expectedCode: string,
) {
  const blocking: TaxRuleEngineBlocking[] = [
    {
      relationship_id: `rel-${effect}`,
      relationship_type:
        effect === 'unmet_dependency'
          ? 'depends_on'
          : effect === 'conflict'
            ? 'conflicts_with'
            : effect === 'exception'
              ? 'exception_to'
              : 'overrides',
      effect,
      from_tax_rule_version_id: 'v-req',
      to_tax_rule_version_id: 'v-other',
    },
  ];
  const member = memberOf(
    evaluate({
      rule_evaluation: tre({
        applicable: [rule('v-req', 'applicable'), rule('v-other', 'applicable')],
        blocking,
      }),
    }),
  );
  assert.equal(member.status, 'legally_constrained');
  assert.deepEqual(codes(member.findings), [expectedCode]);
  assert.equal(member.findings[0]?.relationship_id, `rel-${effect}`);
}

test('TAX-E1 7: conflict → legally_constrained', () => {
  overlayCase('conflict', 'conflict');
});

test('TAX-E1 8: exception → legally_constrained', () => {
  overlayCase('exception', 'exception');
});

test('TAX-E1 9: override → legally_constrained', () => {
  overlayCase('override', 'override');
});

test('TAX-E1 10: unmet dependency → legally_constrained', () => {
  overlayCase('unmet_dependency', 'unmet_dependency');
});

test('TAX-E1 11: alternative_to alone does not constrain or exclude', () => {
  const trace: TaxRuleEngineRelationshipTrace[] = [
    {
      relationship_id: 'rel-alt',
      relationship_type: 'alternative_to',
      from_tax_rule_version_id: 'v-req',
      to_tax_rule_version_id: 'v-alt',
    },
  ];
  const result = evaluate({
    strategies: [
      strategy(),
      strategy({
        strategy_id: 's-2',
        strategy_version_id: 'sv-2',
        strategy_code: 'S2',
        required_rule_pins: [{ tax_rule_version_id: 'v-alt' }],
        exclusive_group_id: null,
      }),
    ],
    rule_evaluation: tre({
      applicable: [rule('v-req', 'applicable'), rule('v-alt', 'applicable')],
      relationship_trace: trace,
    }),
  });
  assert.equal(memberOf(result, 'sv-1').status, 'available');
  assert.equal(memberOf(result, 'sv-2').status, 'available');
  assert.ok(!codes(memberOf(result, 'sv-1').findings).includes('exclusive_group_collision'));
  assert.ok(!codes(memberOf(result, 'sv-1').findings).includes('conflict'));
});

test('TAX-E1 12: two exclusive in-play members → collision / legally_constrained', () => {
  const result = evaluate({
    strategies: [
      strategy({ exclusive_group_id: 'g1' }),
      strategy({
        strategy_id: 's-2',
        strategy_version_id: 'sv-2',
        strategy_code: 'S2',
        exclusive_group_id: 'g1',
        required_rule_pins: [{ tax_rule_version_id: 'v-alt' }],
      }),
    ],
    rule_evaluation: tre({
      applicable: [rule('v-req', 'applicable'), rule('v-alt', 'applicable')],
    }),
  });
  assert.equal(memberOf(result, 'sv-1').status, 'legally_constrained');
  assert.equal(memberOf(result, 'sv-2').status, 'legally_constrained');
  assert.deepEqual(codes(memberOf(result, 'sv-1').findings), ['exclusive_group_collision']);
  assert.deepEqual(memberOf(result, 'sv-1').findings[0]?.peer_strategy_version_ids, ['sv-2']);
});

test('TAX-E1 13: unavailable exclusive peer does not collide', () => {
  const result = evaluate({
    strategies: [
      strategy({ exclusive_group_id: 'g1' }),
      strategy({
        strategy_id: 's-2',
        strategy_version_id: 'sv-2',
        strategy_code: 'S2',
        exclusive_group_id: 'g1',
        required_rule_pins: [{ tax_rule_version_id: 'v-alt' }],
      }),
    ],
    rule_evaluation: tre({
      applicable: [rule('v-req', 'applicable')],
      not_applicable: [rule('v-alt', 'not_applicable')],
    }),
  });
  assert.equal(memberOf(result, 'sv-1').status, 'available');
  assert.equal(memberOf(result, 'sv-2').status, 'unavailable');
  assert.ok(!codes(memberOf(result, 'sv-1').findings).includes('exclusive_group_collision'));
});

test('TAX-E1 14: unevaluable exclusive peer + in-play peer → peer unresolved, no collision', () => {
  const result = evaluate({
    strategies: [
      strategy({ exclusive_group_id: 'g1' }),
      strategy({
        strategy_id: 's-2',
        strategy_version_id: 'sv-2',
        strategy_code: 'S2',
        exclusive_group_id: 'g1',
        required_rule_pins: [{ tax_rule_version_id: 'v-missing' }],
      }),
    ],
    rule_evaluation: tre({ applicable: [rule('v-req', 'applicable')] }),
  });
  const play = memberOf(result, 'sv-1');
  const incomplete = memberOf(result, 'sv-2');
  assert.equal(play.status, 'unevaluable');
  assert.equal(incomplete.status, 'unevaluable');
  assert.deepEqual(codes(play.findings), ['exclusive_group_peer_not_resolved']);
  assert.ok(!codes(play.findings).includes('exclusive_group_collision'));
  assert.ok(!codes(incomplete.findings).includes('exclusive_group_collision'));
  assert.deepEqual(play.findings[0]?.peer_strategy_version_ids, ['sv-2']);
});

test('TAX-E1 15: Owner judgment clean → judgment_required', () => {
  const member = memberOf(
    evaluate({ strategies: [strategy({ requires_professional_judgment: true })] }),
  );
  assert.equal(member.status, 'judgment_required');
  assert.deepEqual(codes(member.findings), ['requires_professional_judgment']);
  assert.equal(member.findings[0]?.severity, 'judgment');
});

test('TAX-E1 16: Owner judgment + missing facts → unevaluable, both findings retained', () => {
  const member = memberOf(
    evaluate({
      strategies: [strategy({ requires_professional_judgment: true })],
      rule_evaluation: tre({
        undetermined: [rule('v-req', 'undetermined', { missing_facts: ['income'] })],
      }),
    }),
  );
  assert.equal(member.status, 'unevaluable');
  assert.deepEqual(codes(member.findings), ['missing_facts', 'requires_professional_judgment']);
});

test('TAX-E1 17: Owner judgment + not_applicable → unavailable, judgment retained', () => {
  const member = memberOf(
    evaluate({
      strategies: [strategy({ requires_professional_judgment: true })],
      rule_evaluation: tre({ not_applicable: [rule('v-req', 'not_applicable')] }),
    }),
  );
  assert.equal(member.status, 'unavailable');
  assert.deepEqual(codes(member.findings), ['required_rule_not_applicable', 'requires_professional_judgment']);
});

test('TAX-E1 18: blocking unresolved → legally_constrained, not judgment_required', () => {
  const linked: TaxRuleEngineBlockingLinkedRequirement[] = [
    {
      relationship_id: null,
      unresolved_legal_reference_id: 'unr-1',
      relationship_type: 'depends_on',
      effect: 'unresolved_dependency',
      from_tax_rule_version_id: 'v-req',
      to_tax_rule_version_id: null,
    },
  ];
  const unresolved: TaxRuleEngineUnresolvedLegalReference[] = [
    {
      id: 'unr-1',
      from_tax_rule_version_id: 'v-req',
      relationship_intent: 'depends_on',
      activation_critical: null,
      cited_title: 'Missing statute',
      cited_law_name: null,
      cited_instrument_kind: 'law',
      cited_provision_number: null,
      locator_text: 'art 1',
      status: 'open',
    },
  ];
  const member = memberOf(
    evaluate({
      rule_evaluation: tre({
        applicable: [rule('v-req', 'applicable')],
        blocking_linked_requirements: linked,
        unresolved_legal_references: unresolved,
      }),
    }),
  );
  assert.equal(member.status, 'legally_constrained');
  assert.deepEqual(codes(member.findings), ['unresolved_legal_reference_blocking']);
  assert.ok(!codes(member.findings).includes('requires_professional_judgment'));
  assert.ok(!codes(member.findings).includes('unresolved_legal_reference'));
});

test('TAX-E1 19: non-blocking unresolved → info only', () => {
  const unresolved: TaxRuleEngineUnresolvedLegalReference[] = [
    {
      id: 'unr-info',
      from_tax_rule_version_id: 'v-req',
      relationship_intent: 'alternative_to',
      activation_critical: null,
      cited_title: 'Note',
      cited_law_name: null,
      cited_instrument_kind: 'other',
      cited_provision_number: null,
      locator_text: 'see',
      status: 'open',
    },
  ];
  const member = memberOf(
    evaluate({
      rule_evaluation: tre({
        applicable: [rule('v-req', 'applicable')],
        unresolved_legal_references: unresolved,
      }),
    }),
  );
  assert.equal(member.status, 'available');
  assert.deepEqual(codes(member.findings), ['unresolved_legal_reference']);
  assert.equal(member.findings[0]?.severity, 'info');
});

test('TAX-E1 20: required calculation absent → unevaluable', () => {
  const member = memberOf(
    evaluate({
      strategies: [strategy({ calculation_pins: [{ calculation_definition_version_id: 'cdv-1' }] })],
    }),
  );
  assert.equal(member.status, 'unevaluable');
  assert.deepEqual(codes(member.findings), ['calculation_not_supplied']);
});

test('TAX-E1 21: calculation pin mismatch → unevaluable', () => {
  const member = memberOf(
    evaluate({
      strategies: [strategy({ calculation_pins: [{ calculation_definition_version_id: 'cdv-1' }] })],
      calculations: [calc({ country_code: 'US', as_of: '2026-01-01' })],
    }),
  );
  assert.equal(member.status, 'unevaluable');
  assert.deepEqual(codes(member.findings), ['calculation_pin_mismatch']);
});

test('TAX-E1 22: calculation missing inputs → unevaluable', () => {
  const member = memberOf(
    evaluate({
      strategies: [strategy({ calculation_pins: [{ calculation_definition_version_id: 'cdv-1' }] })],
      calculations: [
        calc({
          status: 'blocked',
          result: null,
          blocking: [{ code: 'missing_legal_value', message: 'missing' }],
          missing_inputs: ['legal:vat'],
        }),
      ],
    }),
  );
  assert.equal(member.status, 'unevaluable');
  assert.deepEqual(codes(member.findings), ['calculation_missing_inputs']);
  assert.deepEqual(member.findings[0]?.k4_blocking_codes, ['missing_legal_value']);
  assert.equal(member.calculations.length, 0);
});

test('TAX-E1 23: arithmetic/type blocked calculation → info only', () => {
  const member = memberOf(
    evaluate({
      strategies: [strategy({ calculation_pins: [{ calculation_definition_version_id: 'cdv-1' }] })],
      calculations: [
        calc({
          status: 'blocked',
          result: null,
          blocking: [{ code: 'division_by_zero', message: 'div0' }],
        }),
      ],
    }),
  );
  assert.equal(member.status, 'available');
  assert.deepEqual(codes(member.findings), ['calculation_blocked']);
  assert.equal(member.findings[0]?.severity, 'info');
  assert.equal(member.calculations[0]?.status, 'blocked');
});

test('TAX-E1 24/25: deterministic ordering and checksum', () => {
  const input = {
    strategies: [
      strategy({
        strategy_id: 's-b',
        strategy_version_id: 'sv-b',
        strategy_code: 'SB',
        required_rule_pins: [{ tax_rule_version_id: 'v-b' }, { tax_rule_version_id: 'v-a' }],
      }),
      strategy({
        strategy_id: 's-a',
        strategy_version_id: 'sv-a',
        strategy_code: 'SA',
        required_rule_pins: [{ tax_rule_version_id: 'v-missing' }],
      }),
    ],
    rule_evaluation: tre({
      not_applicable: [rule('v-b', 'not_applicable')],
      undetermined: [rule('v-a', 'undetermined', { missing_facts: ['z', 'a'] })],
    }),
  };
  const first = evaluate(input);
  const second = evaluate(input);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.members.map((row) => row.strategy_code),
    ['SA', 'SB'],
  );
  assert.deepEqual(codes(memberOf(first, 'sv-b').findings), [
    'missing_facts',
    'required_rule_not_applicable',
  ]);
  assert.deepEqual(memberOf(first, 'sv-b').findings[0]?.missing_facts, ['a', 'z']);
  assert.match(first.evaluation_checksum, /^[a-f0-9]{64}$/);
  assert.notEqual(
    first.evaluation_checksum,
    evaluate({ rule_evaluation: tre({ applicable: [rule('v-req', 'applicable')] }) }).evaluation_checksum,
  );
});

test('TAX-E1 26: no rank / recommendation / confidence percentage', () => {
  const result = evaluate({});
  const json = JSON.stringify(result);
  assert.doesNotMatch(json, /rank|recommend|confidence|percent/);
  assert.equal('rank' in result, false);
  assert.equal('recommendation' in memberOf(result), false);
});

test('TAX-E1 finding severities are locked to codes', () => {
  assert.equal(TAX_STRATEGY_FINDING_CODES.length, 19);
  assert.equal(statusFromFindings([{ code: 'calculation_blocked', severity: 'info' }]), 'available');
  assert.equal(TAX_STRATEGY_FINDING_SEVERITY_BY_CODE.required_rule_not_evaluated, 'incomplete');
});
