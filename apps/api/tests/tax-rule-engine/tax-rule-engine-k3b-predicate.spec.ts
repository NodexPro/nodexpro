import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAppliesIf,
  evaluateTaxRulePredicate,
  parseAndValidatePredicate,
  validateTaxRulePayloadPredicates,
} from '../../src/domains/tax-rule-engine/tax-rule-engine-predicate.pure.js';
import { evaluateTaxRules } from '../../src/domains/tax-rule-engine/tax-rule-engine-evaluate.pure.js';
import { AppError } from '../../src/shared/errors.js';
import {
  EVALUATION_AS_OF_FACT,
  isCanonicalIsoDate,
  parseEvaluateTaxRulesInput,
  parseIsoDate,
} from '../../src/domains/tax-rule-engine/tax-rule-engine.types.js';
import { TAX_KNOWLEDGE_ERROR_CODES } from '../../src/domains/tax-knowledge/tax-knowledge.types.js';
import { conflict } from '../../src/shared/errors.js';

test('TAX-K3B pure: in/not_in/between and dates', () => {
  const facts = {
    residency_status: 'resident',
    age: 40,
    aliyah_date: '2024-06-01',
  };

  assert.equal(
    evaluateTaxRulePredicate({ fact: 'residency_status', op: 'in', value: ['resident', 'returning_resident'] }, facts).kind,
    'true',
  );
  assert.equal(
    evaluateTaxRulePredicate({ fact: 'residency_status', op: 'not_in', value: ['non_resident'] }, facts).kind,
    'true',
  );
  assert.equal(
    evaluateTaxRulePredicate({ fact: 'age', type: 'number', op: 'between', value: { from: 18, to: 67 } }, facts).kind,
    'true',
  );
  assert.equal(
    evaluateTaxRulePredicate({ fact: 'age', type: 'number', op: 'between', value: { from: 50, to: 67 } }, facts).kind,
    'false',
  );
  assert.equal(
    evaluateTaxRulePredicate(
      { fact: 'aliyah_date', type: 'date', op: 'lte', value: '2026-06-01' },
      facts,
    ).kind,
    'true',
  );
  assert.equal(
    evaluateTaxRulePredicate(
      { fact: 'aliyah_date', type: 'date', op: 'between', value: { from: '2024-01-01', to: '2024-12-31' } },
      facts,
    ).kind,
    'true',
  );
});

test('TAX-K3B pure: is_null vs missing vs exists', () => {
  const facts = { spouse_id: null, child_count: 2 };

  assert.equal(evaluateTaxRulePredicate({ fact: 'spouse_id', op: 'is_null' }, facts).kind, 'true');
  assert.equal(evaluateTaxRulePredicate({ fact: 'spouse_id', op: 'exists' }, facts).kind, 'false');
  assert.equal(evaluateTaxRulePredicate({ fact: 'spouse_id', op: 'is_not_null' }, facts).kind, 'false');
  assert.equal(evaluateTaxRulePredicate({ fact: 'child_count', op: 'is_not_null' }, facts).kind, 'true');

  const missingNull = evaluateTaxRulePredicate({ fact: 'unknown', op: 'is_null' }, facts);
  assert.equal(missingNull.kind, 'missing');
  assert.deepEqual(missingNull.missing_facts, ['unknown']);
  assert.equal(evaluateTaxRulePredicate({ fact: 'unknown', op: 'exists' }, facts).kind, 'missing');
});

test('TAX-K3B pure: type mismatch is undetermined, never false', () => {
  const mismatch = evaluateTaxRulePredicate({ fact: 'age', op: 'gte', value: 18 }, { age: '18' });
  assert.equal(mismatch.kind, 'unsupported');
  assert.equal(mismatch.reason, 'type_mismatch');

  const eqMismatch = evaluateTaxRulePredicate({ fact: 'age', op: 'eq', value: 18 }, { age: '18' });
  assert.equal(eqMismatch.kind, 'unsupported');
  assert.equal(eqMismatch.reason, 'type_mismatch');

  const classified = evaluateTaxRules({
    country_code: 'IL',
    as_of: '2026-01-01',
    facts: { age: '18' },
    candidates: [
      {
        tax_rule_id: 'r1',
        rule_code: 'R1',
        tax_rule_version_id: 'v1',
        country_code: 'IL',
        version_no: 1,
        payload_json: { applies_if: { fact: 'age', op: 'gte', value: 18 } },
        payload_checksum: 'x',
        sources: [],
        legal_value_bindings: [],
      },
    ],
    relationships: [],
  });
  assert.deepEqual(
    classified.undetermined.map((row) => row.tax_rule_version_id),
    ['v1'],
  );
  assert.equal(classified.not_applicable.length, 0);
  assert.equal(classified.undetermined[0]?.classification_reason, 'type_mismatch');
  assert.equal(classified.undetermined[0]?.predicate_reason, 'type_mismatch');
});

test('TAX-K3B pure: evaluation_as_of is injected and client supply is rejected', () => {
  const result = evaluateTaxRules({
    country_code: 'IL',
    as_of: '2026-06-01',
    facts: { aliyah_date: '2024-01-15' },
    candidates: [
      {
        tax_rule_id: 'r1',
        rule_code: 'R1',
        tax_rule_version_id: 'v1',
        country_code: 'IL',
        version_no: 1,
        payload_json: {
          applies_if: {
            fact: EVALUATION_AS_OF_FACT,
            type: 'date',
            op: 'gte',
            value: '2026-01-01',
          },
        },
        payload_checksum: 'x',
        sources: [],
        legal_value_bindings: [],
      },
    ],
    relationships: [],
  });
  assert.deepEqual(
    result.applicable.map((row) => row.tax_rule_version_id),
    ['v1'],
  );

  assert.throws(
    () =>
      parseEvaluateTaxRulesInput({
        country_code: 'IL',
        as_of: '2026-01-01',
        facts: { [EVALUATION_AS_OF_FACT]: '2020-01-01' },
      }),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
});

test('TAX-K3B pure: validator accepts null/valid AST and rejects invalid shape', () => {
  assert.equal(validateTaxRulePayloadPredicates({ applies_if: null, does_not_apply_if: null }).ok, true);
  assert.equal(
    parseAndValidatePredicate({
      all: [
        { fact: 'residency_status', type: 'enum', op: 'in', value: ['resident'] },
        { fact: 'age', type: 'number', op: 'between', value: { from: 18, to: 67 } },
      ],
    }).ok,
    true,
  );
  assert.equal(parseAndValidatePredicate('always').ok, false);
  assert.equal(parseAndValidatePredicate({ fact: 'age', op: 'between', value: { from: 20, to: 10 } }).ok, false);
  assert.equal(validateTaxRulePayloadPredicates({ applies_if: 'always' }).ok, false);

  let node: unknown = { fact: 'x', op: 'exists' };
  for (let i = 0; i < 9; i += 1) node = { not: node };
  assert.equal(parseAndValidatePredicate(node).ok, false);
  assert.equal(evaluateTaxRulePredicate(node, { x: true }).kind, 'unsupported');
});

test('TAX-K3B pure: calendar dates reject impossible days and months', () => {
  assert.equal(isCanonicalIsoDate('2026-02-28'), true);
  assert.equal(isCanonicalIsoDate('2024-02-29'), true);
  assert.equal(isCanonicalIsoDate('2026-04-30'), true);
  assert.equal(isCanonicalIsoDate('2026-02-29'), false);
  assert.equal(isCanonicalIsoDate('2026-02-30'), false);
  assert.equal(isCanonicalIsoDate('2026-13-01'), false);
  assert.equal(isCanonicalIsoDate('2026-13-40'), false);
  assert.equal(isCanonicalIsoDate('2026-04-31'), false);

  assert.equal(
    parseAndValidatePredicate({ fact: 'aliyah_date', type: 'date', op: 'eq', value: '2024-02-29' }).ok,
    true,
  );
  assert.equal(
    parseAndValidatePredicate({ fact: 'aliyah_date', type: 'date', op: 'eq', value: '2026-02-28' }).ok,
    true,
  );
  assert.equal(
    parseAndValidatePredicate({ fact: 'aliyah_date', type: 'date', op: 'eq', value: '2026-02-29' }).ok,
    false,
  );
  assert.equal(
    parseAndValidatePredicate({ fact: 'aliyah_date', type: 'date', op: 'eq', value: '2026-13-01' }).ok,
    false,
  );
  assert.equal(
    parseAndValidatePredicate({
      fact: 'aliyah_date',
      type: 'date',
      op: 'between',
      value: { from: '2026-02-30', to: '2026-03-01' },
    }).ok,
    false,
  );

  const runtime = evaluateTaxRulePredicate(
    { fact: 'aliyah_date', type: 'date', op: 'eq', value: '2026-02-29' },
    { aliyah_date: '2026-02-28' },
  );
  assert.equal(runtime.kind, 'unsupported');
  assert.equal(runtime.reason, 'type_mismatch');

  const classified = evaluateTaxRules({
    country_code: 'IL',
    as_of: '2026-01-01',
    facts: { aliyah_date: '2026-02-30' },
    candidates: [
      {
        tax_rule_id: 'r1',
        rule_code: 'R1',
        tax_rule_version_id: 'v-bad-date',
        country_code: 'IL',
        version_no: 1,
        payload_json: { applies_if: { fact: 'aliyah_date', type: 'date', op: 'eq', value: '2026-02-28' } },
        payload_checksum: 'x',
        sources: [],
        legal_value_bindings: [],
      },
    ],
    relationships: [],
  });
  assert.equal(classified.not_applicable.length, 0);
  assert.equal(classified.undetermined[0]?.tax_rule_version_id, 'v-bad-date');
  assert.equal(classified.undetermined[0]?.classification_reason, 'type_mismatch');

  assert.throws(
    () => parseIsoDate('2026-02-29', 'as_of'),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
});

test('TAX-K3B pure: activation rejects invalid calendar date predicates', () => {
  const rejected = validateTaxRulePayloadPredicates({
    applies_if: { fact: 'aliyah_date', type: 'date', op: 'lte', value: '2026-02-29' },
  });
  assert.equal(rejected.ok, false);
  if (rejected.ok) throw new Error('expected invalid predicate');
  const err = conflict(rejected.message, TAX_KNOWLEDGE_ERROR_CODES.INVALID_PREDICATE);
  assert.equal(err.statusCode, 409);
  assert.equal(err.code, TAX_KNOWLEDGE_ERROR_CODES.INVALID_PREDICATE);

  assert.equal(
    validateTaxRulePayloadPredicates({
      applies_if: { fact: 'aliyah_date', type: 'date', op: 'lte', value: '2026-02-28' },
    }).ok,
    true,
  );
});

test('TAX-K3B pure: K3A vacuous applicable still holds', () => {
  assert.equal(evaluateAppliesIf(null, { age: 1 }).kind, 'true');
  const result = evaluateTaxRules({
    country_code: 'IL',
    as_of: '2026-01-01',
    facts: {},
    candidates: [
      {
        tax_rule_id: 'r1',
        rule_code: 'R1',
        tax_rule_version_id: 'v1',
        country_code: 'IL',
        version_no: 1,
        payload_json: { statement: 'legacy', applies_if: null, does_not_apply_if: null },
        payload_checksum: 'x',
        sources: [],
        legal_value_bindings: [],
      },
    ],
    relationships: [],
  });
  assert.equal(result.applicable[0]?.classification, 'applicable');
});
