import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAppliesIf,
  evaluateDoesNotApplyIf,
  evaluateTaxRulePredicate,
} from '../../src/domains/tax-rule-engine/tax-rule-engine-predicate.pure.js';
import { AppError } from '../../src/shared/errors.js';
import { parseEvaluateTaxRulesInput } from '../../src/domains/tax-rule-engine/tax-rule-engine.types.js';

test('TAX-K3A pure: null/omitted applies_if is true and does_not_apply_if is false', () => {
  assert.deepEqual(evaluateAppliesIf(null, {}), { kind: 'true', missing_facts: [] });
  assert.deepEqual(evaluateAppliesIf(undefined, {}), { kind: 'true', missing_facts: [] });
  assert.deepEqual(evaluateDoesNotApplyIf(null, {}), { kind: 'false', missing_facts: [] });
  assert.deepEqual(evaluateDoesNotApplyIf(undefined, {}), { kind: 'false', missing_facts: [] });
});

test('TAX-K3A pure: eq/neq/exists and numeric compare', () => {
  const facts = { residency_status: 'resident', annual_income: 120000, flagged: true, empty: null };

  assert.equal(evaluateTaxRulePredicate({ fact: 'residency_status', op: 'eq', value: 'resident' }, facts).kind, 'true');
  assert.equal(evaluateTaxRulePredicate({ fact: 'residency_status', op: 'eq', value: 'non_resident' }, facts).kind, 'false');
  assert.equal(evaluateTaxRulePredicate({ fact: 'residency_status', op: 'neq', value: 'non_resident' }, facts).kind, 'true');
  const typeMismatch = evaluateTaxRulePredicate({ fact: 'residency_status', op: 'eq', value: 1 }, facts);
  assert.equal(typeMismatch.kind, 'unsupported');
  assert.equal(typeMismatch.reason, 'type_mismatch');
  assert.equal(evaluateTaxRulePredicate({ fact: 'flagged', op: 'exists' }, facts).kind, 'true');
  assert.equal(evaluateTaxRulePredicate({ fact: 'empty', op: 'exists' }, facts).kind, 'false');
  assert.equal(evaluateTaxRulePredicate({ fact: 'annual_income', op: 'gte', value: 120000 }, facts).kind, 'true');
  assert.equal(evaluateTaxRulePredicate({ fact: 'annual_income', op: 'gt', value: 120000 }, facts).kind, 'false');
  assert.equal(evaluateTaxRulePredicate({ fact: 'annual_income', op: 'lt', value: 200000 }, facts).kind, 'true');
});

test('TAX-K3A pure: missing fact and unsupported predicate are undetermined, never false', () => {
  const missing = evaluateTaxRulePredicate({ fact: 'residency_status', op: 'eq', value: 'resident' }, {});
  assert.equal(missing.kind, 'missing');
  assert.deepEqual(missing.missing_facts, ['residency_status']);

  const existsMissing = evaluateTaxRulePredicate({ fact: 'residency_status', op: 'exists' }, {});
  assert.equal(existsMissing.kind, 'missing');

  const unsupportedShape = evaluateTaxRulePredicate('always', {});
  assert.equal(unsupportedShape.kind, 'unsupported');
  assert.deepEqual(unsupportedShape.missing_facts, []);

  const unsupportedOp = evaluateTaxRulePredicate({ fact: 'residency_status', op: 'matches', value: 'x' }, {
    residency_status: 'x',
  });
  assert.equal(unsupportedOp.kind, 'unsupported');

  const unsupportedCompare = evaluateTaxRulePredicate({ fact: 'residency_status', op: 'gt', value: 1 }, {
    residency_status: 'resident',
  });
  assert.equal(unsupportedCompare.kind, 'unsupported');

  const mixed = evaluateAppliesIf(
    { all: [{ fact: 'missing_key', op: 'eq', value: 'a' }, { fact: 'known', op: 'eq', value: 'no' }] },
    { known: 'yes' },
  );
  assert.equal(mixed.kind, 'false');
});

test('TAX-K3A pure: all/any/not are order-independent three-state', () => {
  const facts = { a: 1, b: 2 };

  assert.equal(
    evaluateTaxRulePredicate(
      { all: [{ fact: 'a', op: 'eq', value: 1 }, { fact: 'b', op: 'eq', value: 2 }] },
      facts,
    ).kind,
    'true',
  );
  assert.equal(
    evaluateTaxRulePredicate(
      { all: [{ fact: 'missing', op: 'eq', value: 1 }, { fact: 'a', op: 'eq', value: 0 }] },
      facts,
    ).kind,
    'false',
  );
  const allMissing = evaluateTaxRulePredicate(
    { all: [{ fact: 'missing', op: 'eq', value: 1 }, { fact: 'a', op: 'eq', value: 1 }] },
    facts,
  );
  assert.equal(allMissing.kind, 'missing');
  assert.deepEqual(allMissing.missing_facts, ['missing']);

  assert.equal(
    evaluateTaxRulePredicate(
      { any: [{ fact: 'missing', op: 'eq', value: 1 }, { fact: 'a', op: 'eq', value: 1 }] },
      facts,
    ).kind,
    'true',
  );
  const anyMissing = evaluateTaxRulePredicate(
    { any: [{ fact: 'missing', op: 'eq', value: 1 }, { fact: 'a', op: 'eq', value: 0 }] },
    facts,
  );
  assert.equal(anyMissing.kind, 'missing');

  assert.equal(evaluateTaxRulePredicate({ not: { fact: 'a', op: 'eq', value: 1 } }, facts).kind, 'false');
  assert.equal(evaluateTaxRulePredicate({ not: { fact: 'missing', op: 'eq', value: 1 } }, facts).kind, 'missing');
  assert.equal(evaluateTaxRulePredicate({ not: 'nope' }, facts).kind, 'unsupported');
  assert.equal(evaluateTaxRulePredicate({ all: [], any: [] }, facts).kind, 'unsupported');
});

test('TAX-K3A contract: evaluate input rejects tenant/case selectors and invalid facts', () => {
  const ok = parseEvaluateTaxRulesInput({
    country_code: 'il',
    as_of: '2026-01-01',
    facts: { residency_status: 'resident', annual_income: 1, flagged: false, empty: null },
  });
  assert.deepEqual(ok, {
    country_code: 'IL',
    as_of: '2026-01-01',
    facts: { residency_status: 'resident', annual_income: 1, flagged: false, empty: null },
  });

  for (const field of ['organization_id', 'client_id', 'tax_rule_version_ids', 'country_codes']) {
    assert.throws(
      () => parseEvaluateTaxRulesInput({ country_code: 'IL', as_of: '2026-01-01', facts: {}, [field]: 'x' }),
      (error: unknown) => error instanceof AppError && error.statusCode === 400,
    );
  }

  assert.throws(
    () => parseEvaluateTaxRulesInput({ country_code: 'IL', as_of: '2026-01-01' }),
    (error: unknown) => error instanceof AppError && /facts is required/.test((error as Error).message),
  );
  assert.throws(
    () => parseEvaluateTaxRulesInput({ country_code: 'IL', as_of: '2026-01-01', facts: { nested: { a: 1 } } }),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
});
