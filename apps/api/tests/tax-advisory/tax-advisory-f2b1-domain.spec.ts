import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../../src/shared/errors.js';
import { assertTaxFactAnswerValue } from '../../src/domains/tax-fact-dictionary/tax-fact-dictionary-validation.pure.js';
import {
  assertClientCountryCompatibility,
  requireOrgLegalCountry,
} from '../../src/domains/tax-advisory/tax-advisory-country.pure.js';
import {
  advertisedActionsAreImplemented,
  buildTaxAdvisoryAllowedActions,
} from '../../src/domains/tax-advisory/tax-advisory-allowed-actions.pure.js';
import {
  isTaxAdvisoryCommand,
  TAX_ADVISORY_COMMANDS,
  TAX_ADVISORY_AGGREGATE_KEY,
} from '../../src/domains/tax-advisory/tax-advisory.types.js';
import { ownerFactDictionaryIncludesDefinitionCountry } from '../../src/domains/tax-fact-dictionary/tax-fact-dictionary-read-models.pure.js';

test('TAX-F2B1 country: null client country allowed; mismatch blocked; missing org blocked', () => {
  assert.equal(requireOrgLegalCountry('IL'), 'IL');
  assert.throws(
    () => requireOrgLegalCountry(null),
    (err: unknown) => err instanceof AppError && err.code === 'ORG_LEGAL_COUNTRY_MISSING',
  );
  assert.doesNotThrow(() => assertClientCountryCompatibility('IL', null));
  assert.doesNotThrow(() => assertClientCountryCompatibility('IL', 'il'));
  assert.throws(
    () => assertClientCountryCompatibility('IL', 'US'),
    (err: unknown) => err instanceof AppError && err.code === 'CLIENT_COUNTRY_MISMATCH' && err.statusCode === 409,
  );
});

test('TAX-F2B1 fact values preserve false/0 and reject null/empty/type mismatch', () => {
  assert.equal(assertTaxFactAnswerValue(false, { value_type: 'boolean' }), false);
  assert.equal(assertTaxFactAnswerValue(0, { value_type: 'integer' }), 0);
  assert.equal(assertTaxFactAnswerValue(0, { value_type: 'decimal' }), 0);
  assert.throws(
    () => assertTaxFactAnswerValue(null, { value_type: 'boolean' }),
    (err: unknown) => err instanceof AppError && err.code === 'NULL_ANSWER_REJECTED',
  );
  assert.throws(
    () => assertTaxFactAnswerValue('', { value_type: 'string' }),
    (err: unknown) => err instanceof AppError && err.code === 'EMPTY_STRING_REJECTED',
  );
  assert.throws(
    () => assertTaxFactAnswerValue('true', { value_type: 'boolean' }),
    (err: unknown) => err instanceof AppError && err.code === 'FACT_TYPE_MISMATCH',
  );
  assert.throws(
    () => assertTaxFactAnswerValue(1.5, { value_type: 'integer' }),
    (err: unknown) => err instanceof AppError && err.code === 'FACT_TYPE_MISMATCH',
  );
  assert.equal(assertTaxFactAnswerValue('resident', { value_type: 'enum', enum_codes: ['resident'] }), 'resident');
  assert.throws(() => assertTaxFactAnswerValue('other', { value_type: 'enum', enum_codes: ['resident'] }));
  assert.deepEqual(
    assertTaxFactAnswerValue(
      { amount: 0, currency: 'ILS' },
      { value_type: 'money', currency_policy: { required: true, allowed_currencies: ['ILS'] } },
    ),
    { amount: 0, currency: 'ILS' },
  );
});

test('TAX-F2B1 catalog includes global + selected country only', () => {
  assert.equal(ownerFactDictionaryIncludesDefinitionCountry(null, 'IL'), true);
  assert.equal(ownerFactDictionaryIncludesDefinitionCountry('IL', 'IL'), true);
  assert.equal(ownerFactDictionaryIncludesDefinitionCountry('US', 'IL'), false);
});

test('TAX-F2B1 allowed_actions ⊆ implemented commands', () => {
  const actions = buildTaxAdvisoryAllowedActions({
    canEdit: true,
    hasOpenCase: true,
    lifecycleState: 'draft',
  });
  assert.equal(advertisedActionsAreImplemented(actions), true);
  for (const action of actions) {
    assert.equal(isTaxAdvisoryCommand(action.action_key), true);
  }
  assert.deepEqual([...TAX_ADVISORY_COMMANDS], [
    'create_tax_advisory_case',
    'set_tax_advisory_case_fact',
    'clear_tax_advisory_case_fact',
    'archive_tax_advisory_case',
  ]);
  const archived = buildTaxAdvisoryAllowedActions({
    canEdit: true,
    hasOpenCase: false,
    lifecycleState: null,
  });
  assert.equal(archived.find((a) => a.action_key === 'create_tax_advisory_case')?.enabled, true);
  assert.equal(archived.find((a) => a.action_key === 'set_tax_advisory_case_fact')?.enabled, false);
  const viewer = buildTaxAdvisoryAllowedActions({
    canEdit: false,
    hasOpenCase: true,
    lifecycleState: 'draft',
  });
  assert.equal(viewer.every((a) => a.enabled === false), true);
  assert.equal(TAX_ADVISORY_AGGREGATE_KEY, 'tax_advisory_case_aggregate');
});
