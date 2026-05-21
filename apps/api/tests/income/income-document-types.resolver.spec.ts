import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  assertDocumentTypeEnabled,
  buildAvailableDocumentTypesForBusiness,
} from '../../src/domains/income/income-document-types.fallback.js';
const dir = dirname(fileURLToPath(import.meta.url));
const resolverSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-types.resolver.ts'),
  'utf8',
);
const coreReadSource = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-client-core.read.ts'),
  'utf8',
);

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

test('office_representative resolver reads Client Operations core client row', () => {
  assert.match(coreReadSource, /עוסק מורשה[\s\S]*return 'osek_murshe'/);
  assert.match(resolverSource, /loadClientOperationsCoreClient\(orgId, scope\.represented_client_id\)/);
  assert.match(resolverSource, /mapClientOperationsBusinessTypeForIncomeIssuer\(raw\)/);
  assert.doesNotMatch(resolverSource, /from\('client_operational_profiles'\)/);
});

test('select issuer command builds workspace aggregate from same context scope', () => {
  const commandsSource = readFileSync(
    join(dir, '../../src/domains/income/income-commands.service.ts'),
    'utf8',
  );
  assert.doesNotMatch(commandsSource, /Promise\.all\([\s\S]*buildIncomeWorkspaceContextAggregate[\s\S]*buildIncomeWorkspaceAggregate/);
  assert.match(commandsSource, /activeIncomeIssuerScopeFromContextAggregate/);
  assert.match(commandsSource, /buildIncomeWorkspaceAggregate\(ctx, scope\)/);
});

test('osek_murshe (from עוסק מורשה) enables tax_invoice receipt and credit', () => {
  const bt = 'osek_murshe' as const;
  const enabled = enabledKeys(bt);
  assert.ok(enabled.includes('tax_invoice'));
  assert.ok(enabled.includes('tax_invoice_receipt'));
  assert.ok(enabled.includes('credit_tax_invoice'));
  assert.ok(enabled.includes('receipt'));
  const tax = buildAvailableDocumentTypesForBusiness(bt).find((t) => t.key === 'tax_invoice');
  assert.equal(tax?.disabled_reason, null);
});
