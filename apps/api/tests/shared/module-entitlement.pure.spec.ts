import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isIncomeCommercialModuleCode,
  resolveModuleEntitlementCode,
} from '../../src/shared/module-entitlement.pure.js';

test('resolveModuleEntitlementCode maps income route to invoice catalog', () => {
  assert.equal(resolveModuleEntitlementCode('income'), 'invoice');
  assert.equal(resolveModuleEntitlementCode('invoice'), 'invoice');
  assert.equal(resolveModuleEntitlementCode('docflow'), 'docflow');
});

test('isIncomeCommercialModuleCode includes legacy invoice code', () => {
  assert.equal(isIncomeCommercialModuleCode('invoice'), true);
  assert.equal(isIncomeCommercialModuleCode('income'), true);
  assert.equal(isIncomeCommercialModuleCode('clients'), false);
});
