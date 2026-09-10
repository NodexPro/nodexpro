import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUSINESS_SETUP_BASE_PATH,
  TAX_ADVISORY_MODULE_CODE,
  businessSetupClientPath,
  inferTaxAdvisoryModuleCodeFromPath,
  isTaxAdvisoryModulePath,
  rewriteLegacyTaxAdvisoryPath,
} from '../src/modules/business-setup-routes.ts';

test('legacy tax-advisory paths rewrite to business-setup', () => {
  assert.equal(rewriteLegacyTaxAdvisoryPath('/m/tax-advisory'), BUSINESS_SETUP_BASE_PATH);
  assert.equal(rewriteLegacyTaxAdvisoryPath('/m/tax-advisory/'), BUSINESS_SETUP_BASE_PATH);
  assert.equal(
    rewriteLegacyTaxAdvisoryPath('/m/tax-advisory/clients/abc'),
    '/m/business-setup/clients/abc',
  );
  assert.equal(rewriteLegacyTaxAdvisoryPath('/m/business-setup'), null);
  assert.equal(rewriteLegacyTaxAdvisoryPath('/clients'), null);
});

test('module code stays tax-advisory on both public path prefixes', () => {
  assert.equal(inferTaxAdvisoryModuleCodeFromPath('/m/business-setup'), TAX_ADVISORY_MODULE_CODE);
  assert.equal(inferTaxAdvisoryModuleCodeFromPath('/m/business-setup/clients/x'), TAX_ADVISORY_MODULE_CODE);
  assert.equal(inferTaxAdvisoryModuleCodeFromPath('/m/tax-advisory/clients/x'), TAX_ADVISORY_MODULE_CODE);
  assert.equal(inferTaxAdvisoryModuleCodeFromPath('/m/income'), null);
  assert.equal(businessSetupClientPath('c1'), '/m/business-setup/clients/c1');
  assert.equal(isTaxAdvisoryModulePath('/m/business-setup'), true);
});
