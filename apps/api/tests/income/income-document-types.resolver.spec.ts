import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDocumentTypeEnabled,
  buildAvailableDocumentTypesForBusiness,
} from '../../src/domains/income/income-document-types.fallback.js';

function enabledKeys(businessType: Parameters<typeof buildAvailableDocumentTypesForBusiness>[0]): string[] {
  return buildAvailableDocumentTypesForBusiness(businessType)
    .filter((t) => t.enabled)
    .map((t) => t.key);
}

function disabledKeys(businessType: Parameters<typeof buildAvailableDocumentTypesForBusiness>[0]): string[] {
  return buildAvailableDocumentTypesForBusiness(businessType)
    .filter((t) => !t.enabled)
    .map((t) => t.key);
}

test('workspace document types list has six IL types', () => {
  const types = buildAvailableDocumentTypesForBusiness('osek_murshe');
  assert.equal(types.length, 6);
  assert.ok(types.every((t) => t.source === 'fallback_il'));
  assert.equal(types[0]?.country_code, 'IL');
});

test('osek_patur disables tax_invoice, tax_invoice_receipt, credit_tax_invoice', () => {
  const disabled = disabledKeys('osek_patur');
  assert.deepEqual(disabled.sort(), ['credit_tax_invoice', 'tax_invoice', 'tax_invoice_receipt'].sort());
  const enabled = enabledKeys('osek_patur');
  assert.deepEqual(enabled.sort(), ['deal_invoice', 'quote', 'receipt'].sort());
});

test('osek_murshe enables all tax documents', () => {
  const enabled = enabledKeys('osek_murshe');
  assert.ok(enabled.includes('tax_invoice'));
  assert.ok(enabled.includes('tax_invoice_receipt'));
  assert.ok(enabled.includes('credit_tax_invoice'));
});

test('company enables all document types', () => {
  const types = buildAvailableDocumentTypesForBusiness('company');
  assert.ok(types.every((t) => t.enabled));
});

test('unknown business type enables only quote and deal_invoice with disabled_reason on others', () => {
  const enabled = enabledKeys('unknown');
  assert.deepEqual(enabled.sort(), ['deal_invoice', 'quote'].sort());
  const tax = buildAvailableDocumentTypesForBusiness('unknown').find((t) => t.key === 'tax_invoice');
  assert.equal(tax?.enabled, false);
  assert.ok(tax?.disabled_reason);
});

test('assertDocumentTypeEnabled rejects disabled document_type', () => {
  const available = buildAvailableDocumentTypesForBusiness('osek_patur');
  assert.throws(
    () => assertDocumentTypeEnabled(available, 'tax_invoice'),
    (err: unknown) => err instanceof Object && 'statusCode' in (err as { statusCode: number }),
  );
});

test('assertDocumentTypeEnabled accepts enabled document_type', () => {
  const available = buildAvailableDocumentTypesForBusiness('osek_patur');
  assert.doesNotThrow(() => assertDocumentTypeEnabled(available, 'receipt'));
});

test('receipt requires payment_received and not due_date', () => {
  const receipt = buildAvailableDocumentTypesForBusiness('osek_murshe').find((t) => t.key === 'receipt');
  assert.equal(receipt?.requires_payment_received, true);
  assert.equal(receipt?.requires_due_date, false);
});
