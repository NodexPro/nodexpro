import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../../src/shared/errors.js';
import {
  parseCalculateTaxCommandPayload,
  runCalculateTax,
} from '../../src/domains/tax-calculation-engine/tax-calculation-engine-calculate.pure.js';
import { TAX_CALCULATION_RESULT_AGGREGATE_KEY } from '../../src/domains/tax-calculation-engine/tax-calculation-engine-commands.types.js';

function pctExpr(versionId = 'lv-old') {
  return { op: 'legal_value', node_id: 'lv', legal_value_version_id: versionId, value_key: 'vat_rate' };
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
    ...overrides,
  };
}

function rulePin(overrides: Record<string, unknown> = {}) {
  return {
    tax_rule_version_id: 'rv-1',
    country_code: 'IL',
    tax_rule_id: 'rule-1',
    version_no: 1,
    effective_from: '2024-01-01',
    effective_to: null,
    ...overrides,
  };
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    country_code: 'IL',
    as_of: '2026-06-01',
    currency: 'ILS',
    expression: pctExpr(),
    facts: {},
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

function mustOk(result: ReturnType<typeof runCalculateTax>) {
  assert.equal(result.ok, true);
  return result;
}

function expectBadRequest(fn: () => unknown) {
  assert.throws(fn, (error: unknown) => error instanceof AppError && error.statusCode === 400);
}

test('TAX-K4C 4: successful calculation returns status calculated', () => {
  const out = mustOk(runCalculateTax(validPayload()));
  assert.equal(out.command, 'calculate_tax');
  assert.equal(out.refreshed.aggregate_key, TAX_CALCULATION_RESULT_AGGREGATE_KEY);
  assert.equal(out.refreshed.aggregate.status, 'calculated');
  assert.deepEqual(out.refreshed.aggregate.result, { type: 'percentage', value: '17' });
  assert.deepEqual(out.refreshed.aggregate.blocking, []);
  assert.deepEqual(out.refreshed.aggregate.missing_inputs, []);
});

test('TAX-K4C 3/25/26/27: aggregate key and exact pins', () => {
  const out = mustOk(
    runCalculateTax(
      validPayload({
        rule_pins: [rulePin(), rulePin({ tax_rule_version_id: 'rv-basis', tax_rule_id: 'rule-b' })],
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
    ),
  );
  const agg = out.refreshed.aggregate;
  assert.equal(agg.aggregate_key, 'tax_calculation_result_aggregate');
  assert.deepEqual(
    agg.rule_pins.map((pin) => pin.tax_rule_version_id),
    ['rv-1', 'rv-basis'],
  );
  assert.equal(agg.legal_value_pins[0]?.legal_value_version_id, 'lv-old');
  assert.equal(agg.calculation_basis_pins[0]?.to_tax_rule_version_id, 'rv-basis');
  assert.deepEqual(agg.unresolved_calculation_basis, []);
});

test('TAX-K4C 5/7: missing legal value is blocked calculation, not HTTP error', () => {
  const out = mustOk(runCalculateTax(validPayload({ legal_value_pins: [] })));
  assert.equal(out.refreshed.aggregate.status, 'blocked');
  assert.equal(out.refreshed.aggregate.result, null);
  assert.equal(out.refreshed.aggregate.blocking[0]?.code, 'missing_legal_value');
});

test('TAX-K4C 6/28: missing_input appears in blocking and backend-built missing_inputs', () => {
  const out = mustOk(
    runCalculateTax(
      validPayload({
        expression: { op: 'input', node_id: 'i', key: 'taxable_income', type: 'decimal' },
        facts: {},
      }),
    ),
  );
  assert.equal(out.refreshed.aggregate.status, 'blocked');
  assert.equal(out.refreshed.aggregate.blocking[0]?.code, 'missing_input');
  assert.deepEqual(out.refreshed.aggregate.missing_inputs, ['taxable_income']);
});

test('TAX-K4C 8: missing required rule pin is calculation block', () => {
  const out = mustOk(runCalculateTax(validPayload({ rule_pins: [], required_tax_rule_version_ids: ['rv-1'] })));
  assert.equal(out.refreshed.aggregate.status, 'blocked');
  assert.equal(out.refreshed.aggregate.blocking[0]?.code, 'missing_rule_pin');
});

test('TAX-K4C 9: unresolved calculation_basis is calculation block', () => {
  const out = mustOk(
    runCalculateTax(
      validPayload({
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
    ),
  );
  assert.equal(out.refreshed.aggregate.status, 'blocked');
  assert.equal(out.refreshed.aggregate.blocking[0]?.code, 'unresolved_calculation_basis');
});

test('TAX-K4C 10: country mismatch is calculation block', () => {
  const out = mustOk(runCalculateTax(validPayload({ legal_value_pins: [snapshot({ country_code: 'US' })] })));
  assert.equal(out.refreshed.aggregate.status, 'blocked');
  assert.equal(out.refreshed.aggregate.blocking[0]?.code, 'country_mismatch');
});

test('TAX-K4C 11: pin_not_effective_as_of is calculation block', () => {
  const out = mustOk(
    runCalculateTax(
      validPayload({
        as_of: '2023-12-31',
        legal_value_pins: [snapshot({ effective_from: '2024-01-01', effective_to: '2026-12-31' })],
      }),
    ),
  );
  assert.equal(out.refreshed.aggregate.status, 'blocked');
  assert.equal(out.refreshed.aggregate.blocking[0]?.code, 'pin_not_effective_as_of');
});

test('TAX-K4C 12: division_by_zero is calculation block', () => {
  const out = mustOk(
    runCalculateTax(
      validPayload({
        expression: {
          op: 'div',
          node_id: 'd',
          left: { op: 'const', node_id: 'l', type: 'decimal', value: '10' },
          right: { op: 'const', node_id: 'r', type: 'decimal', value: '0' },
        },
        required_tax_rule_version_ids: [],
        legal_value_pins: [],
      }),
    ),
  );
  assert.equal(out.refreshed.aggregate.status, 'blocked');
  assert.equal(out.refreshed.aggregate.blocking[0]?.code, 'division_by_zero');
});

test('TAX-K4C 13: currency mismatch is calculation block', () => {
  const out = mustOk(
    runCalculateTax(
      validPayload({
        expression: {
          op: 'add',
          node_id: 'a',
          left: { op: 'const', node_id: 'l', type: 'money', value: '1', currency: 'ILS' },
          right: { op: 'const', node_id: 'r', type: 'money', value: '1', currency: 'USD' },
        },
        required_tax_rule_version_ids: [],
        legal_value_pins: [],
      }),
    ),
  );
  assert.equal(out.refreshed.aggregate.status, 'blocked');
  assert.equal(out.refreshed.aggregate.blocking[0]?.code, 'currency_mismatch');
});

test('TAX-K4C 14/15: malformed command and invalid as_of are HTTP 400', () => {
  expectBadRequest(() => runCalculateTax(validPayload({ expression: undefined })));
  expectBadRequest(() => parseCalculateTaxCommandPayload(validPayload({ as_of: '2024-02-30' })));
  expectBadRequest(() => parseCalculateTaxCommandPayload(validPayload({ as_of: '2024-1-01' })));
  expectBadRequest(() => parseCalculateTaxCommandPayload(validPayload({ country_code: '' })));
  expectBadRequest(() => parseCalculateTaxCommandPayload(validPayload({ rule_pins: 'nope' })));
});

test('TAX-K4C 16/17: organization_id and client_id rejected', () => {
  expectBadRequest(() => parseCalculateTaxCommandPayload({ ...validPayload(), organization_id: 'org-1' }));
  expectBadRequest(() => parseCalculateTaxCommandPayload({ ...validPayload(), client_id: 'client-1' }));
});

test('TAX-K4C 24/29: deterministic equivalent aggregate and no timestamp/random fields', () => {
  const first = mustOk(runCalculateTax(validPayload()));
  const second = mustOk(runCalculateTax(validPayload()));
  assert.deepEqual(first, second);
  const json = JSON.stringify(first.refreshed.aggregate);
  assert.equal(json.includes('created_at'), false);
  assert.equal(json.includes('evaluated_at'), false);
  assert.equal(json.includes('Date.now'), false);
  assert.equal(first.refreshed.aggregate.context_checksum, second.refreshed.aggregate.context_checksum);
  assert.equal(first.refreshed.aggregate.result_checksum, second.refreshed.aggregate.result_checksum);
  assert.equal(first.refreshed.aggregate.execution_checksum, second.refreshed.aggregate.execution_checksum);
});
