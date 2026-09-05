import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateTaxCalculation,
  taxCalculationInputChecksum,
} from '../../src/domains/tax-calculation-engine/tax-calculation-engine-evaluate.pure.js';
import { validateTaxCalculationExpression } from '../../src/domains/tax-calculation-engine/tax-calculation-engine-validate.pure.js';
import {
  TAX_CALCULATION_ENGINE_MAX_EXPRESSION_DEPTH,
  TAX_CALCULATION_ENGINE_MAX_EXPRESSION_NODES,
  TAX_CALCULATION_BLOCKED_CODES,
} from '../../src/domains/tax-calculation-engine/tax-calculation-engine.types.js';

function dec(node_id: string, value: string) {
  return { op: 'const' as const, node_id, type: 'decimal' as const, value };
}

function money(node_id: string, value: string, currency: string) {
  return { op: 'const' as const, node_id, type: 'money' as const, value, currency };
}

function pct(node_id: string, value: string) {
  return { op: 'const' as const, node_id, type: 'percentage' as const, value };
}

function int(node_id: string, value: string) {
  return { op: 'const' as const, node_id, type: 'integer' as const, value };
}

function bool(node_id: string, value: boolean) {
  return { op: 'const' as const, node_id, type: 'boolean' as const, value };
}

function add(node_id: string, left: unknown, right: unknown) {
  return { op: 'add' as const, node_id, left, right };
}

function mustOk(result: ReturnType<typeof evaluateTaxCalculation>) {
  assert.equal(result.ok, true, result.ok ? '' : `${result.blocked.code}: ${result.blocked.message}`);
  if (!result.ok) throw new Error('expected ok');
  return result;
}

function mustBlocked(result: ReturnType<typeof evaluateTaxCalculation>, code: string) {
  assert.equal(result.ok, false, result.ok ? `expected ${code} but got ok ${JSON.stringify(result.result)}` : '');
  if (result.ok) throw new Error('expected blocked');
  assert.equal(result.blocked.code, code);
  return result;
}

test('TAX-K4A 1: exact add/sub/mul/div', () => {
  const added = mustOk(evaluateTaxCalculation({ expression: add('a', dec('l', '2.5'), dec('r', '3.5')) }));
  assert.deepEqual(added.result, { type: 'decimal', value: '6' });

  const sub = mustOk(
    evaluateTaxCalculation({
      expression: { op: 'sub', node_id: 's', left: money('l', '10.00', 'ILS'), right: money('r', '2.50', 'ILS') },
    }),
  );
  assert.deepEqual(sub.result, { type: 'money', value: '7.5', currency: 'ILS' });

  const mul = mustOk(
    evaluateTaxCalculation({
      expression: { op: 'mul', node_id: 'm', left: money('l', '3.5', 'USD'), right: dec('r', '2') },
    }),
  );
  assert.deepEqual(mul.result, { type: 'money', value: '7', currency: 'USD' });

  const div = mustOk(
    evaluateTaxCalculation({
      expression: { op: 'div', node_id: 'd', left: dec('l', '10'), right: dec('r', '4') },
    }),
  );
  assert.deepEqual(div.result, { type: 'decimal', value: '2.5' });
});

test('TAX-K4A 2: 0.1 + 0.2 = 0.3 exactly', () => {
  const result = mustOk(evaluateTaxCalculation({ expression: add('a', dec('l', '0.1'), dec('r', '0.2')) }));
  assert.deepEqual(result.result, { type: 'decimal', value: '0.3' });
});

test('TAX-K4A 3: division by zero', () => {
  mustBlocked(
    evaluateTaxCalculation({
      expression: { op: 'div', node_id: 'd', left: dec('l', '10'), right: dec('r', '0') },
    }),
    'division_by_zero',
  );
});

test('TAX-K4A 4: percent_of 100,15 = 15', () => {
  const result = mustOk(
    evaluateTaxCalculation({
      expression: { op: 'percent_of', node_id: 'p', base: int('b', '100'), rate: pct('r', '15') },
    }),
  );
  assert.deepEqual(result.result, { type: 'decimal', value: '15' });
});

test('TAX-K4A 5: min/max/clamp', () => {
  const min = mustOk(
    evaluateTaxCalculation({
      expression: { op: 'min', node_id: 'n', args: [dec('a', '9.5'), dec('b', '2.25'), dec('c', '4')] },
    }),
  );
  assert.deepEqual(min.result, { type: 'decimal', value: '2.25' });

  const max = mustOk(
    evaluateTaxCalculation({
      expression: { op: 'max', node_id: 'x', args: [dec('a', '9.5'), dec('b', '2.25')] },
    }),
  );
  assert.deepEqual(max.result, { type: 'decimal', value: '9.5' });

  const clamp = mustOk(
    evaluateTaxCalculation({
      expression: { op: 'clamp', node_id: 'k', value: dec('v', '12'), min: dec('lo', '0'), max: dec('hi', '10') },
    }),
  );
  assert.deepEqual(clamp.result, { type: 'decimal', value: '10' });
});

test('TAX-K4A 6: typed if', () => {
  const taken = mustOk(
    evaluateTaxCalculation({
      expression: {
        op: 'if',
        node_id: 'i',
        cond: bool('c', true),
        then: money('t', '10', 'ILS'),
        else: money('e', '20', 'ILS'),
      },
    }),
  );
  assert.deepEqual(taken.result, { type: 'money', value: '10', currency: 'ILS' });

  mustBlocked(
    evaluateTaxCalculation({
      expression: {
        op: 'if',
        node_id: 'i',
        cond: bool('c', true),
        then: money('t', '10', 'ILS'),
        else: dec('e', '20'),
      },
    }),
    'type_mismatch',
  );
});

test('TAX-K4A 7: missing input', () => {
  mustBlocked(
    evaluateTaxCalculation({
      expression: { op: 'input', node_id: 'i', key: 'taxable_income' },
      facts: {},
    }),
    'missing_input',
  );
});

test('TAX-K4A 8: missing legal value', () => {
  mustBlocked(
    evaluateTaxCalculation({
      expression: { op: 'legal_value', node_id: 'l', legal_value_version_id: 'lv-missing' },
      legal_values: [],
    }),
    'missing_legal_value',
  );
});

test('TAX-K4A 9: type mismatch', () => {
  mustBlocked(
    evaluateTaxCalculation({
      expression: add('a', dec('l', '1'), bool('r', true)),
    }),
    'type_mismatch',
  );
});

test('TAX-K4A 10: currency mismatch', () => {
  mustBlocked(
    evaluateTaxCalculation({
      expression: add('a', money('l', '1', 'ILS'), money('r', '1', 'USD')),
    }),
    'currency_mismatch',
  );
});

test('TAX-K4A 11: all four rounding modes', () => {
  const modes = [
    { mode: 'half_up' as const, expected: '1.3' },
    { mode: 'half_even' as const, expected: '1.2' },
    { mode: 'floor' as const, expected: '1.2' },
    { mode: 'ceil' as const, expected: '1.3' },
  ];
  for (const { mode, expected } of modes) {
    const result = mustOk(
      evaluateTaxCalculation({
        expression: { op: 'round', node_id: 'r', value: dec('v', '1.25'), rounding: { mode, scale: 1 } },
      }),
    );
    assert.deepEqual(result.result, { type: 'decimal', value: expected }, mode);
    assert.deepEqual(result.trace.at(-1)?.rounding, { mode, scale: 1 });
  }
});

test('TAX-K4A 12: node rounding override', () => {
  const result = mustOk(
    evaluateTaxCalculation({
      expression: {
        op: 'add',
        node_id: 'a',
        left: dec('l', '1.25'),
        right: dec('r', '0'),
        rounding: { mode: 'half_up', scale: 1 },
      },
      default_rounding: { mode: 'half_even', scale: 1 },
    }),
  );
  assert.deepEqual(result.result, { type: 'decimal', value: '1.3' });
  const addTrace = result.trace.find((row) => row.node_id === 'a' && row.rounding_source !== 'final_default');
  assert.deepEqual(addTrace?.rounding, { mode: 'half_up', scale: 1 });
  assert.equal(addTrace?.rounding_source, 'explicit');
  assert.equal(result.trace.some((row) => row.rounding_source === 'final_default'), false);
});

function thirdRate(node_id: string) {
  return { op: 'div' as const, node_id, left: pct(`${node_id}-n`, '1'), right: pct(`${node_id}-d`, '3') };
}

test('TAX-K4A rounding A: exact intermediates then final default, not 0.99', () => {
  const result = mustOk(
    evaluateTaxCalculation({
      expression: {
        op: 'mul',
        node_id: 'mul',
        left: { op: 'div', node_id: 'div', left: dec('one', '1'), right: dec('three', '3') },
        right: dec('times', '3'),
      },
      default_rounding: { mode: 'half_up', scale: 2 },
    }),
  );
  assert.deepEqual(result.result, { type: 'decimal', value: '1.00' });

  const div = result.trace.find((row) => row.node_id === 'div');
  const mul = result.trace.find((row) => row.node_id === 'mul' && row.rounding_source !== 'final_default');
  const final = result.trace.find((row) => row.rounding_source === 'final_default');
  assert.ok(div);
  assert.ok(mul);
  assert.ok(final);
  assert.equal(div?.rounding, undefined);
  assert.equal(div?.rounding_source, undefined);
  assert.notEqual(div?.output.value, '0.33');
  assert.notEqual(mul?.output.value, '0.99');
  assert.equal(mul?.rounding, undefined);
  assert.equal(mul?.rounding_source, undefined);
  assert.deepEqual(final?.rounding, { mode: 'half_up', scale: 2 });
  assert.deepEqual(final?.inputs[0]?.value, mul?.output);
  assert.deepEqual(final?.output, { type: 'decimal', value: '1.00' });
});

test('TAX-K4A rounding B: explicit intermediate round(1/3)*3 = 0.99', () => {
  const result = mustOk(
    evaluateTaxCalculation({
      expression: {
        op: 'mul',
        node_id: 'mul',
        left: {
          op: 'round',
          node_id: 'rnd',
          value: { op: 'div', node_id: 'div', left: dec('one', '1'), right: dec('three', '3') },
          rounding: { mode: 'half_up', scale: 2 },
        },
        right: dec('times', '3'),
      },
      default_rounding: { mode: 'half_up', scale: 2 },
    }),
  );
  assert.deepEqual(result.result, { type: 'decimal', value: '0.99' });

  const div = result.trace.find((row) => row.node_id === 'div');
  const rnd = result.trace.find((row) => row.node_id === 'rnd');
  const mul = result.trace.find((row) => row.node_id === 'mul' && row.rounding_source !== 'final_default');
  const final = result.trace.find((row) => row.rounding_source === 'final_default');
  assert.equal(div?.rounding, undefined);
  assert.deepEqual(rnd?.output, { type: 'decimal', value: '0.33' });
  assert.deepEqual(rnd?.rounding, { mode: 'half_up', scale: 2 });
  assert.equal(rnd?.rounding_source, 'explicit');
  assert.deepEqual(mul?.output, { type: 'decimal', value: '0.99' });
  assert.equal(mul?.rounding, undefined);
  assert.ok(final);
  assert.deepEqual(final?.output, { type: 'decimal', value: '0.99' });
  assert.equal(final?.rounding_source, 'final_default');
});

test('TAX-K4A rounding C: percent_of and bracket slices stay exact', () => {
  const p1 = { op: 'percent_of' as const, node_id: 'p1', base: dec('b1', '1'), rate: thirdRate('r1') };
  const p2 = { op: 'percent_of' as const, node_id: 'p2', base: dec('b2', '1'), rate: thirdRate('r2') };
  const p3 = { op: 'percent_of' as const, node_id: 'p3', base: dec('b3', '1'), rate: thirdRate('r3') };
  const percentSum = mustOk(
    evaluateTaxCalculation({
      expression: {
        op: 'add',
        node_id: 'a2',
        left: { op: 'add', node_id: 'a1', left: p1, right: p2 },
        right: p3,
      },
      default_rounding: { mode: 'half_up', scale: 2 },
    }),
  );
  assert.deepEqual(percentSum.result, { type: 'decimal', value: '0.01' });
  for (const id of ['p1', 'p2', 'p3', 'a1']) {
    const row = percentSum.trace.find((entry) => entry.node_id === id);
    assert.equal(row?.rounding, undefined, id);
    assert.equal(row?.rounding_source, undefined, id);
  }
  assert.equal(percentSum.trace.find((row) => row.node_id === 'p1')?.output.value !== '0.00', true);

  const third = mustOk(
    evaluateTaxCalculation({
      expression: { op: 'div', node_id: 'd', left: pct('n', '1'), right: pct('den', '3') },
    }),
  );
  assert.equal(third.result.type, 'percentage');
  const thirdRateValue = third.result.type === 'percentage' ? third.result.value : '';
  const bracket = mustOk(
    evaluateTaxCalculation({
      expression: {
        op: 'bracket_apply',
        node_id: 'br',
        amount: dec('amt', '3'),
        table: {
          brackets: [
            { up_to: '1', rate: thirdRateValue },
            { up_to: '2', rate: thirdRateValue },
            { up_to: null, rate: thirdRateValue },
          ],
        },
      },
      default_rounding: { mode: 'half_up', scale: 2 },
    }),
  );
  const bracketNode = bracket.trace.find((row) => row.node_id === 'br' && row.rounding_source !== 'final_default');
  assert.equal(bracketNode?.rounding, undefined);
  assert.equal(bracketNode?.rounding_source, undefined);
  assert.notEqual(bracketNode?.output.value, '0.00');
  assert.deepEqual(bracket.result, { type: 'decimal', value: '0.01' });
  assert.equal(bracket.trace.some((row) => row.rounding_source === 'final_default'), true);
});

test('TAX-K4A rounding D: trace distinguishes exact / explicit / final default', () => {
  const exact = mustOk(
    evaluateTaxCalculation({
      expression: add('a', dec('l', '0.1'), dec('r', '0.2')),
    }),
  );
  assert.equal(
    exact.trace.every((row) => row.rounding === undefined && row.rounding_source === undefined),
    true,
  );

  const explicit = mustOk(
    evaluateTaxCalculation({
      expression: { op: 'round', node_id: 'r', value: dec('v', '1.25'), rounding: { mode: 'half_up', scale: 1 } },
    }),
  );
  assert.equal(explicit.trace.find((row) => row.op === 'round')?.rounding_source, 'explicit');

  const viaDefault = mustOk(
    evaluateTaxCalculation({
      expression: { op: 'round', node_id: 'r', value: dec('v', '1.25') },
      default_rounding: { mode: 'half_even', scale: 1 },
    }),
  );
  assert.equal(viaDefault.trace.find((row) => row.op === 'round')?.rounding_source, 'round_default');
  assert.deepEqual(viaDefault.result, { type: 'decimal', value: '1.2' });
  assert.equal(viaDefault.trace.some((row) => row.rounding_source === 'final_default'), false);
});

test('TAX-K4A 13: bracket_apply boundaries', () => {
  const table = {
    brackets: [
      { up_to: '100', rate: '10' },
      { up_to: '200', rate: '20' },
      { up_to: null, rate: '30' },
    ],
  };

  const below = mustOk(
    evaluateTaxCalculation({
      expression: { op: 'bracket_apply', node_id: 'b', amount: dec('a', '50'), table },
    }),
  );
  assert.deepEqual(below.result, { type: 'decimal', value: '5' });

  const exact = mustOk(
    evaluateTaxCalculation({
      expression: { op: 'bracket_apply', node_id: 'b', amount: dec('a', '100'), table },
    }),
  );
  assert.deepEqual(exact.result, { type: 'decimal', value: '10' });

  const mid = mustOk(
    evaluateTaxCalculation({
      expression: { op: 'bracket_apply', node_id: 'b', amount: dec('a', '150'), table },
    }),
  );
  assert.deepEqual(mid.result, { type: 'decimal', value: '20' });

  const open = mustOk(
    evaluateTaxCalculation({
      expression: { op: 'bracket_apply', node_id: 'b', amount: dec('a', '250'), table },
    }),
  );
  assert.deepEqual(open.result, { type: 'decimal', value: '45' });
});

test('TAX-K4A 14: invalid bracket tables', () => {
  mustBlocked(
    evaluateTaxCalculation({
      expression: { op: 'bracket_apply', node_id: 'b', amount: dec('a', '10'), table: { brackets: [] } },
    }),
    'invalid_bracket_table',
  );
  mustBlocked(
    evaluateTaxCalculation({
      expression: {
        op: 'bracket_apply',
        node_id: 'b',
        amount: dec('a', '10'),
        table: {
          brackets: [
            { up_to: '100', rate: '10' },
            { up_to: '50', rate: '20' },
          ],
        },
      },
    }),
    'invalid_bracket_table',
  );
  mustBlocked(
    evaluateTaxCalculation({
      expression: {
        op: 'bracket_apply',
        node_id: 'b',
        amount: dec('a', '10'),
        table: {
          brackets: [
            { up_to: null, rate: '10' },
            { up_to: '100', rate: '20' },
          ],
        },
      },
    }),
    'invalid_bracket_table',
  );
  mustBlocked(
    evaluateTaxCalculation({
      expression: {
        op: 'bracket_apply',
        node_id: 'b',
        amount: dec('a', '10'),
        table: {
          brackets: [
            { up_to: '100', rate: '10' },
            { up_to: '100', rate: '20' },
          ],
        },
      },
    }),
    'invalid_bracket_table',
  );
});

test('TAX-K4A 15: date validation', () => {
  const ok = mustOk(
    evaluateTaxCalculation({
      expression: { op: 'const', node_id: 'd', type: 'date', value: '2024-02-29' },
    }),
  );
  assert.deepEqual(ok.result, { type: 'date', value: '2024-02-29' });

  mustBlocked(
    evaluateTaxCalculation({
      expression: { op: 'const', node_id: 'd', type: 'date', value: '2024-02-30' },
    }),
    'invalid_expression',
  );
  mustBlocked(
    evaluateTaxCalculation({
      expression: { op: 'const', node_id: 'd', type: 'date', value: '2024-1-01' },
    }),
    'invalid_expression',
  );
});

function nestDepth(depth: number): unknown {
  if (depth === 1) return dec('c1', '1');
  return add(`a${depth}`, nestDepth(depth - 1), dec(`r${depth}`, '0'));
}

test('TAX-K4A 16: AST depth limit', () => {
  assert.equal(TAX_CALCULATION_ENGINE_MAX_EXPRESSION_DEPTH, 8);
  assert.equal(mustOk(evaluateTaxCalculation({ expression: nestDepth(8) })).ok, true);
  const blocked = validateTaxCalculationExpression(nestDepth(9));
  assert.equal(blocked.ok, false);
  if (blocked.ok) throw new Error('expected depth limit');
  assert.equal(blocked.code, 'invalid_expression');
  assert.match(blocked.message, /max depth 8/);
});

test('TAX-K4A 17: node-count limit', () => {
  assert.equal(TAX_CALCULATION_ENGINE_MAX_EXPRESSION_NODES, 64);
  const okArgs = Array.from({ length: 63 }, (_, index) => dec(`c${index}`, '1'));
  assert.equal(
    mustOk(evaluateTaxCalculation({ expression: { op: 'min', node_id: 'm', args: okArgs } })).ok,
    true,
  );
  const failArgs = Array.from({ length: 64 }, (_, index) => dec(`c${index}`, '1'));
  const blocked = validateTaxCalculationExpression({ op: 'min', node_id: 'm', args: failArgs });
  assert.equal(blocked.ok, false);
  if (blocked.ok) throw new Error('expected node limit');
  assert.equal(blocked.code, 'invalid_expression');
  assert.match(blocked.message, /max nodes 64/);
});

test('TAX-K4A 18: no silent coercion', () => {
  mustBlocked(
    evaluateTaxCalculation({
      expression: { op: 'const', node_id: 'c', type: 'decimal', value: 0.1 },
    }),
    'invalid_expression',
  );
  mustBlocked(
    evaluateTaxCalculation({
      expression: add('a', dec('l', '1'), { op: 'input', node_id: 'i', key: 'flag' }),
      facts: { flag: { type: 'boolean', value: true } },
    }),
    'type_mismatch',
  );
  mustBlocked(
    evaluateTaxCalculation({
      expression: { op: 'input', node_id: 'i', key: 'age', type: 'integer' },
      facts: { age: { type: 'string', value: '40' } },
    }),
    'type_mismatch',
  );
  mustBlocked(
    evaluateTaxCalculation({
      expression: { op: 'const', node_id: 'c', type: 'boolean', value: 'true' },
    }),
    'invalid_expression',
  );
});

test('TAX-K4A 19: deterministic trace', () => {
  const expression = {
    op: 'percent_of',
    node_id: 'p',
    base: add('a', dec('l', '40'), dec('r', '60')),
    rate: pct('rate', '15'),
  };
  const first = mustOk(evaluateTaxCalculation({ expression }));
  const second = mustOk(evaluateTaxCalculation({ expression }));
  assert.deepEqual(first.result, { type: 'decimal', value: '15' });
  assert.deepEqual(first.trace, second.trace);
  assert.equal(first.trace.length > 0, true);
  for (const entry of first.trace) {
    assert.equal(typeof entry.node_id, 'string');
    assert.equal(typeof entry.op, 'string');
    assert.ok(Array.isArray(entry.inputs));
    assert.ok(entry.output);
  }
  const legal = mustOk(
    evaluateTaxCalculation({
      expression: { op: 'legal_value', node_id: 'lv', legal_value_version_id: 'lv-1', value_key: 'vat_rate' },
      legal_values: [{ legal_value_version_id: 'lv-1', value_key: 'vat_rate', type: 'percentage', value: '17' }],
    }),
  );
  assert.deepEqual(legal.trace[0]?.legal_value, { legal_value_version_id: 'lv-1', value_key: 'vat_rate' });
});

test('TAX-K4A 20: deterministic checksum/canonical form', () => {
  const expression = add('a', dec('l', '0.1'), dec('r', '0.2'));
  const first = mustOk(evaluateTaxCalculation({ expression }));
  const second = mustOk(evaluateTaxCalculation({ expression }));
  assert.equal(first.input_checksum, second.input_checksum);
  assert.equal(first.result_checksum, second.result_checksum);
  const validated = validateTaxCalculationExpression(expression);
  assert.equal(validated.ok, true);
  if (!validated.ok) throw new Error('expected valid expression');
  assert.equal(
    first.input_checksum,
    taxCalculationInputChecksum({
      expression: validated.expression,
      facts: {},
      legal_values: [],
    }),
  );
});

test('TAX-K4A 21: legal_value uses supplied pin only', () => {
  const result = mustOk(
    evaluateTaxCalculation({
      expression: { op: 'legal_value', node_id: 'lv', legal_value_version_id: 'lv-old', value_key: 'vat_rate' },
      legal_values: [
        { legal_value_version_id: 'lv-new', value_key: 'vat_rate', type: 'percentage', value: '18' },
        { legal_value_version_id: 'lv-old', value_key: 'vat_rate', type: 'percentage', value: '17' },
      ],
    }),
  );
  assert.deepEqual(result.result, { type: 'percentage', value: '17' });
});

test('TAX-K4A blocked codes are the locked set', () => {
  assert.deepEqual(TAX_CALCULATION_BLOCKED_CODES, [
    'missing_input',
    'missing_legal_value',
    'type_mismatch',
    'division_by_zero',
    'currency_mismatch',
    'invalid_bracket_table',
    'invalid_expression',
  ]);
});
