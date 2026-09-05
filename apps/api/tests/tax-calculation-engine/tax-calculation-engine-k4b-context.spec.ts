import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateTaxCalculationWithContext,
  taxCalculationContextChecksum,
} from '../../src/domains/tax-calculation-engine/tax-calculation-engine-context.pure.js';
import { TAX_CALCULATION_CONTEXT_BLOCKED_CODES } from '../../src/domains/tax-calculation-engine/tax-calculation-engine-context.types.js';

function pctExpr(node_id: string, versionId: string, value_key = 'vat_rate') {
  return { op: 'legal_value' as const, node_id, legal_value_version_id: versionId, value_key };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    legal_value_id: 'lv-id-1',
    legal_value_version_id: 'lv-old',
    value_key: 'vat_rate',
    country_code: 'IL',
    type: 'percentage',
    value: '17',
    effective_from: '2024-01-01',
    effective_to: null,
    source_checksum: 'src-1',
    snapshot_checksum: 'snap-1',
    ...overrides,
  };
}

function rulePin(overrides: Record<string, unknown> = {}) {
  return {
    tax_rule_version_id: 'rv-1',
    country_code: 'IL',
    tax_rule_id: 'rule-1',
    version_no: 1,
    payload_checksum: 'rule-sum-1',
    effective_from: '2024-01-01',
    effective_to: null,
    ...overrides,
  };
}

function baseContext(overrides: Record<string, unknown> = {}) {
  return {
    country_code: 'IL',
    as_of: '2026-06-01',
    currency: 'ILS',
    facts: { amount: { type: 'decimal', value: '100' } },
    rule_pins: [rulePin()],
    required_tax_rule_version_ids: ['rv-1'],
    legal_value_pins: [snapshot()],
    calculation_basis: [],
    definition: {
      calculation_definition_id: 'def-1',
      calculation_definition_version_id: 'defv-1',
      expression_checksum: 'expr-1',
    },
    ...overrides,
  };
}

function mustOk(result: ReturnType<typeof evaluateTaxCalculationWithContext>) {
  assert.equal(result.ok, true, result.ok ? '' : `${result.blocked.code}: ${result.blocked.message}`);
  if (!result.ok) throw new Error('expected ok');
  return result;
}

function mustBlocked(result: ReturnType<typeof evaluateTaxCalculationWithContext>, code: string) {
  assert.equal(result.ok, false, result.ok ? `expected ${code} but got ok` : '');
  if (result.ok) throw new Error('expected blocked');
  assert.equal(result.blocked.code, code);
  assert.equal(result.blocking[0]?.code, code);
  return result;
}

test('TAX-K4B 1: exact legal_value_version pin used', () => {
  const result = mustOk(
    evaluateTaxCalculationWithContext({
      context: baseContext(),
      expression: pctExpr('lv', 'lv-old'),
    }),
  );
  assert.deepEqual(result.result, { type: 'percentage', value: '17' });
  assert.equal(result.legal_value_pins[0]?.legal_value_version_id, 'lv-old');
  assert.equal(result.trace[0]?.legal_value?.legal_value_version_id, 'lv-old');
});

test('TAX-K4B 2: newer alternative supplied elsewhere is ignored', () => {
  const result = mustOk(
    evaluateTaxCalculationWithContext({
      context: baseContext({
        legal_value_pins: [
          snapshot({ legal_value_version_id: 'lv-new', value: '18', snapshot_checksum: 'snap-new' }),
          snapshot({ legal_value_version_id: 'lv-old', value: '17' }),
        ],
      }),
      expression: pctExpr('lv', 'lv-old'),
    }),
  );
  assert.deepEqual(result.result, { type: 'percentage', value: '17' });
  assert.notEqual(result.trace[0]?.legal_value?.legal_value_version_id, 'lv-new');
});

test('TAX-K4B 3: missing exact legal value blocks', () => {
  mustBlocked(
    evaluateTaxCalculationWithContext({
      context: baseContext({ legal_value_pins: [] }),
      expression: pctExpr('lv', 'lv-old'),
    }),
    'missing_legal_value',
  );
});

test('TAX-K4B 4: missing required rule pin blocks', () => {
  mustBlocked(
    evaluateTaxCalculationWithContext({
      context: baseContext({ rule_pins: [], required_tax_rule_version_ids: ['rv-1'] }),
      expression: pctExpr('lv', 'lv-old'),
    }),
    'missing_rule_pin',
  );
});

test('TAX-K4B 6: unresolved required calculation_basis blocks', () => {
  mustBlocked(
    evaluateTaxCalculationWithContext({
      context: baseContext({
        calculation_basis: [
          {
            kind: 'unresolved',
            required: true,
            unresolved_legal_reference_id: 'unref-1',
            relationship_intent: 'calculation_basis',
            locator: 'art. 12',
            country_code: 'IL',
          },
        ],
      }),
      expression: pctExpr('lv', 'lv-old'),
    }),
    'unresolved_calculation_basis',
  );
});

test('TAX-K4B 7: resolved basis + exact target pin succeeds', () => {
  const result = mustOk(
    evaluateTaxCalculationWithContext({
      context: baseContext({
        rule_pins: [rulePin(), rulePin({ tax_rule_version_id: 'rv-basis', tax_rule_id: 'rule-basis', version_no: 2 })],
        calculation_basis: [
          {
            kind: 'resolved',
            required: true,
            relationship_id: 'rel-1',
            from_tax_rule_version_id: 'rv-1',
            to_tax_rule_version_id: 'rv-basis',
            country_code: 'IL',
          },
        ],
      }),
      expression: pctExpr('lv', 'lv-old'),
    }),
  );
  assert.equal(result.calculation_basis_pins[0]?.to_tax_rule_version_id, 'rv-basis');
  assert.equal(result.unresolved_calculation_basis.length, 0);
});

test('TAX-K4B 8: resolved basis but target pin missing blocks', () => {
  mustBlocked(
    evaluateTaxCalculationWithContext({
      context: baseContext({
        calculation_basis: [
          {
            kind: 'resolved',
            required: true,
            relationship_id: 'rel-1',
            from_tax_rule_version_id: 'rv-1',
            to_tax_rule_version_id: 'rv-missing',
            country_code: 'IL',
          },
        ],
      }),
      expression: pctExpr('lv', 'lv-old'),
    }),
    'missing_calculation_basis_pin',
  );
});

test('TAX-K4B 9: direct links only — no walk to an unpinned grandchild', () => {
  const result = mustOk(
    evaluateTaxCalculationWithContext({
      context: baseContext({
        rule_pins: [rulePin(), rulePin({ tax_rule_version_id: 'rv-child', tax_rule_id: 'rule-child' })],
        calculation_basis: [
          {
            kind: 'resolved',
            required: true,
            relationship_id: 'rel-direct',
            from_tax_rule_version_id: 'rv-1',
            to_tax_rule_version_id: 'rv-child',
            country_code: 'IL',
          },
        ],
      }),
      expression: pctExpr('lv', 'lv-old'),
    }),
  );
  assert.deepEqual(
    result.calculation_basis_pins.map((row) => row.to_tax_rule_version_id),
    ['rv-child'],
  );
  assert.equal(
    result.calculation_basis_pins.some((row) => row.to_tax_rule_version_id === 'rv-grandchild'),
    false,
  );
});

test('TAX-K4B 10: country mismatch legal value rejected', () => {
  mustBlocked(
    evaluateTaxCalculationWithContext({
      context: baseContext({
        legal_value_pins: [snapshot({ country_code: 'US' })],
      }),
      expression: pctExpr('lv', 'lv-old'),
    }),
    'country_mismatch',
  );
});

test('TAX-K4B 11: country mismatch rule pin rejected', () => {
  mustBlocked(
    evaluateTaxCalculationWithContext({
      context: baseContext({
        rule_pins: [rulePin({ country_code: 'US' })],
      }),
      expression: pctExpr('lv', 'lv-old'),
    }),
    'country_mismatch',
  );
});

test('TAX-K4B 12: country mismatch basis rejected', () => {
  mustBlocked(
    evaluateTaxCalculationWithContext({
      context: baseContext({
        rule_pins: [rulePin(), rulePin({ tax_rule_version_id: 'rv-basis' })],
        calculation_basis: [
          {
            kind: 'resolved',
            required: true,
            from_tax_rule_version_id: 'rv-1',
            to_tax_rule_version_id: 'rv-basis',
            country_code: 'US',
          },
        ],
      }),
      expression: pctExpr('lv', 'lv-old'),
    }),
    'country_mismatch',
  );
});

test('TAX-K4B 13: valid as_of/effective pin accepted', () => {
  const result = mustOk(
    evaluateTaxCalculationWithContext({
      context: baseContext({
        as_of: '2024-01-01',
        legal_value_pins: [snapshot({ effective_from: '2024-01-01', effective_to: '2026-12-31' })],
      }),
      expression: pctExpr('lv', 'lv-old'),
    }),
  );
  assert.deepEqual(result.result, { type: 'percentage', value: '17' });
});

test('TAX-K4B 14: out-of-window pinned version blocks without re-resolve', () => {
  mustBlocked(
    evaluateTaxCalculationWithContext({
      context: baseContext({
        as_of: '2023-12-31',
        legal_value_pins: [snapshot({ effective_from: '2024-01-01', effective_to: '2026-12-31' })],
      }),
      expression: pctExpr('lv', 'lv-old'),
    }),
    'pin_not_effective_as_of',
  );
});

test('TAX-K4B 15: invalid canonical as_of rejected', () => {
  mustBlocked(
    evaluateTaxCalculationWithContext({
      context: baseContext({ as_of: '2024-02-30' }),
      expression: pctExpr('lv', 'lv-old'),
    }),
    'invalid_expression',
  );
  mustBlocked(
    evaluateTaxCalculationWithContext({
      context: baseContext({ as_of: '2024-1-01' }),
      expression: pctExpr('lv', 'lv-old'),
    }),
    'invalid_expression',
  );
});

test('TAX-K4B 16: array ordering does not change context checksum', () => {
  const first = baseContext({
    legal_value_pins: [snapshot(), snapshot({ legal_value_version_id: 'lv-b', value: '10' })],
    rule_pins: [rulePin({ tax_rule_version_id: 'rv-b' }), rulePin()],
    required_tax_rule_version_ids: ['rv-1', 'rv-b'],
    calculation_basis: [
      {
        kind: 'resolved',
        required: false,
        relationship_id: 'rel-b',
        from_tax_rule_version_id: 'rv-1',
        to_tax_rule_version_id: 'rv-b',
        country_code: 'IL',
      },
      {
        kind: 'unresolved',
        required: false,
        unresolved_legal_reference_id: 'unref-z',
        relationship_intent: 'calculation_basis',
        locator: 'b',
      },
    ],
  });
  const second = {
    ...first,
    legal_value_pins: [...first.legal_value_pins].reverse(),
    rule_pins: [...first.rule_pins].reverse(),
    required_tax_rule_version_ids: [...first.required_tax_rule_version_ids].reverse(),
    calculation_basis: [...first.calculation_basis].reverse(),
  };
  assert.equal(taxCalculationContextChecksum(first as never), taxCalculationContextChecksum(second as never));
});

test('TAX-K4B 17-19: exact pin and unresolved locator changes affect checksum', () => {
  const base = baseContext({
    calculation_basis: [
      {
        kind: 'unresolved',
        required: false,
        unresolved_legal_reference_id: 'unref-1',
        relationship_intent: 'calculation_basis',
        locator: 'art. 12',
      },
    ],
  });
  const ruleChanged = baseContext({
    rule_pins: [rulePin({ tax_rule_version_id: 'rv-other' })],
    required_tax_rule_version_ids: ['rv-other'],
    calculation_basis: base.calculation_basis,
  });
  const legalChanged = baseContext({
    legal_value_pins: [snapshot({ legal_value_version_id: 'lv-other' })],
    calculation_basis: base.calculation_basis,
  });
  const unresolvedChanged = baseContext({
    calculation_basis: [
      {
        kind: 'unresolved',
        required: false,
        unresolved_legal_reference_id: 'unref-1',
        relationship_intent: 'calculation_basis',
        locator: 'art. 13',
      },
    ],
  });
  const baseSum = taxCalculationContextChecksum(base as never);
  assert.notEqual(baseSum, taxCalculationContextChecksum(ruleChanged as never));
  assert.notEqual(baseSum, taxCalculationContextChecksum(legalChanged as never));
  assert.notEqual(baseSum, taxCalculationContextChecksum(unresolvedChanged as never));
});

test('TAX-K4B checksum A-F: country/as_of/currency/rounding/definition changes affect context_checksum', () => {
  const base = baseContext({ default_rounding: { mode: 'half_up', scale: 2 } });
  const baseSum = taxCalculationContextChecksum(base as never);
  assert.notEqual(baseSum, taxCalculationContextChecksum(baseContext({ default_rounding: { mode: 'half_up', scale: 2 }, country_code: 'US' }) as never));
  assert.notEqual(baseSum, taxCalculationContextChecksum(baseContext({ default_rounding: { mode: 'half_up', scale: 2 }, as_of: '2026-06-02' }) as never));
  assert.notEqual(baseSum, taxCalculationContextChecksum(baseContext({ default_rounding: { mode: 'half_up', scale: 2 }, currency: 'USD' }) as never));
  assert.notEqual(
    baseSum,
    taxCalculationContextChecksum(baseContext({ default_rounding: { mode: 'half_even', scale: 2 } }) as never),
  );
  assert.notEqual(
    baseSum,
    taxCalculationContextChecksum(
      baseContext({
        default_rounding: { mode: 'half_up', scale: 2 },
        definition: { calculation_definition_id: 'def-1', calculation_definition_version_id: 'defv-2', expression_checksum: 'expr-1' },
      }) as never,
    ),
  );
  assert.notEqual(
    baseSum,
    taxCalculationContextChecksum(
      baseContext({
        default_rounding: { mode: 'half_up', scale: 2 },
        definition: { calculation_definition_id: 'def-1', calculation_definition_version_id: 'defv-1', expression_checksum: 'expr-2' },
      }) as never,
    ),
  );
});

test('TAX-K4B checksum H: fact object key order does not change context_checksum', () => {
  const factsAB = {
    amount: { type: 'decimal' as const, value: '100' },
    flag: { type: 'boolean' as const, value: true },
  };
  const factsBA = {
    flag: { type: 'boolean' as const, value: true },
    amount: { type: 'decimal' as const, value: '100' },
  };
  assert.deepEqual(Object.keys(factsAB), ['amount', 'flag']);
  assert.deepEqual(Object.keys(factsBA), ['flag', 'amount']);
  assert.equal(
    taxCalculationContextChecksum(baseContext({ facts: factsAB }) as never),
    taxCalculationContextChecksum(baseContext({ facts: factsBA }) as never),
  );
});

test('TAX-K4B 20: same exact context + expression is deterministic', () => {
  const input = {
    context: baseContext({
      rule_pins: [rulePin(), rulePin({ tax_rule_version_id: 'rv-basis' })],
      calculation_basis: [
        {
          kind: 'resolved',
          required: true,
          relationship_id: 'rel-1',
          from_tax_rule_version_id: 'rv-1',
          to_tax_rule_version_id: 'rv-basis',
          country_code: 'IL',
        },
      ],
    }),
    expression: pctExpr('lv', 'lv-old'),
  };
  const first = mustOk(evaluateTaxCalculationWithContext(input));
  const second = mustOk(evaluateTaxCalculationWithContext(input));
  assert.deepEqual(first.result, second.result);
  assert.deepEqual(first.trace, second.trace);
  assert.equal(first.context_checksum, second.context_checksum);
  assert.equal(first.result_checksum, second.result_checksum);
  assert.equal(first.execution_checksum, second.execution_checksum);
  assert.deepEqual(first.rule_pins, second.rule_pins);
  assert.deepEqual(first.legal_value_pins, second.legal_value_pins);
  assert.deepEqual(first.calculation_basis_pins, second.calculation_basis_pins);
});

test('TAX-K4B blocked codes remain distinct', () => {
  assert.deepEqual(TAX_CALCULATION_CONTEXT_BLOCKED_CODES, [
    'missing_input',
    'missing_legal_value',
    'type_mismatch',
    'division_by_zero',
    'currency_mismatch',
    'invalid_bracket_table',
    'invalid_expression',
    'missing_rule_pin',
    'unresolved_calculation_basis',
    'missing_calculation_basis_pin',
    'country_mismatch',
    'pin_not_effective_as_of',
  ]);
});
