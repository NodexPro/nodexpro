import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const workEngineApiSource = readFileSync(
  join(dir, '../../../web/src/api/work-engine.ts'),
  'utf8',
);
const customerModalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineInvoiceRetainerCustomerModal.tsx'),
  'utf8',
);
const setupModalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineInvoiceRetainerSetupModal.tsx'),
  'utf8',
);
const overrideModalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineRecurringCycleOverrideModal.tsx'),
  'utf8',
);

test('setup aggregate fetch dedupes in-flight requests by client/end-customer key', () => {
  assert.ok(workEngineApiSource.includes('inFlightInvoiceRetainerSetupFetches'));
  assert.ok(workEngineApiSource.includes('invoiceRetainerSetupFetchKey'));
  assert.ok(workEngineApiSource.includes('cancelWorkEngineInvoiceRetainerSetupAggregateFetch'));
  assert.ok(workEngineApiSource.includes('{ signal: controller.signal }'));
});

test('customer modal cancels list fetch before end-customer selection fetch', () => {
  assert.ok(customerModalSource.includes('selectionGenerationRef'));
  assert.ok(customerModalSource.includes('listAbortRef'));
  assert.ok(customerModalSource.includes('cancelWorkEngineInvoiceRetainerSetupAggregateFetch'));
  assert.ok(customerModalSource.includes('endCustomerId: null'));
  assert.ok(customerModalSource.includes('generation !== selectionGenerationRef.current'));
});

test('setup modal ignores stale setup fetch responses', () => {
  assert.ok(setupModalSource.includes('setupFetchGenerationRef'));
  assert.ok(setupModalSource.includes('generation !== setupFetchGenerationRef.current'));
});

test('future override modal does not fetch invoice-retainer-setup', () => {
  assert.ok(!overrideModalSource.includes('fetchWorkEngineInvoiceRetainerSetupAggregate'));
  assert.ok(!overrideModalSource.includes('invoice-retainer-setup'));
});
