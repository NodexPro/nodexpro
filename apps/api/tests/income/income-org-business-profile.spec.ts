import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isOrgBusinessProfileCompleteForIncome,
  mapLegalEntityTypeToIncomeBusinessType,
  type OrgBusinessProfileForIncome,
} from '../../src/domains/income/income-org-business-profile.mapping.js';
import {
  buildAvailableDocumentTypesForBusiness,
} from '../../src/domains/income/income-document-types.fallback.js';

test('exempt_dealer maps to osek_patur document types', () => {
  assert.equal(mapLegalEntityTypeToIncomeBusinessType('exempt_dealer'), 'osek_patur');
  const enabled = buildAvailableDocumentTypesForBusiness('osek_patur')
    .filter((t) => t.enabled)
    .map((t) => t.key);
  assert.deepEqual(enabled.sort(), ['deal_invoice', 'quote', 'receipt'].sort());
  const disabled = buildAvailableDocumentTypesForBusiness('osek_patur')
    .filter((t) => !t.enabled)
    .map((t) => t.key);
  assert.deepEqual(disabled.sort(), ['credit_tax_invoice', 'tax_invoice', 'tax_invoice_receipt'].sort());
});

test('registered_dealer maps to osek_murshe and enables tax invoices', () => {
  assert.equal(mapLegalEntityTypeToIncomeBusinessType('registered_dealer'), 'osek_murshe');
  const enabled = buildAvailableDocumentTypesForBusiness('osek_murshe')
    .filter((t) => t.enabled)
    .map((t) => t.key);
  assert.ok(enabled.includes('tax_invoice'));
  assert.ok(enabled.includes('tax_invoice_receipt'));
  assert.ok(enabled.includes('credit_tax_invoice'));
});

test('company legal entity enables all document types', () => {
  assert.equal(mapLegalEntityTypeToIncomeBusinessType('company'), 'company');
  const types = buildAvailableDocumentTypesForBusiness('company');
  assert.ok(types.every((t) => t.enabled));
});

test('incomplete self profile is not onboarding complete', () => {
  const incomplete: OrgBusinessProfileForIncome = {
    organization_id: 'org-1',
    legal_business_name: 'Acme',
    legal_name: null,
    legal_entity_type: null,
    tax_id: null,
    country_code: 'IL',
    vat_registration_status: null,
    default_currency: 'ILS',
    default_document_language: 'he',
    normalized_business_type: 'unknown',
  };
  assert.equal(isOrgBusinessProfileCompleteForIncome(incomplete), false);
});

test('complete self profile with exempt_dealer is onboarding complete', () => {
  const complete: OrgBusinessProfileForIncome = {
    organization_id: 'org-1',
    legal_business_name: 'Acme Ltd',
    legal_name: null,
    legal_entity_type: 'exempt_dealer',
    tax_id: '123',
    country_code: 'IL',
    vat_registration_status: null,
    default_currency: 'ILS',
    default_document_language: 'he',
    normalized_business_type: 'osek_patur',
  };
  assert.equal(isOrgBusinessProfileCompleteForIncome(complete), true);
});
