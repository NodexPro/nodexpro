import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isSupportedIncomePaymentDocumentType,
  resolveIncomeInvoiceOriginalAmount,
  resolveIncomeInvoicePaymentState,
  incomePaymentMethodLabel,
  parseIncomePaymentMethodKey,
} from '../../src/domains/accounting-base/accounting-base-income-payment.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));

test('payment state: unpaid / partial / paid Hebrew labels', () => {
  assert.deepEqual(resolveIncomeInvoicePaymentState(4000, 0), {
    payment_state_key: 'unpaid',
    payment_state_label: 'לא שולם',
    payment_state_tone: 'danger',
    remaining_balance: 4000,
  });
  assert.deepEqual(resolveIncomeInvoicePaymentState(4000, 1500), {
    payment_state_key: 'partial',
    payment_state_label: 'שולם חלקית',
    payment_state_tone: 'warning',
    remaining_balance: 2500,
  });
  assert.deepEqual(resolveIncomeInvoicePaymentState(4000, 4000), {
    payment_state_key: 'paid',
    payment_state_label: 'שולם',
    payment_state_tone: 'success',
    remaining_balance: 0,
  });
});

test('original amount prefers grand_total_reference', () => {
  assert.equal(
    resolveIncomeInvoiceOriginalAmount({
      grand_total_reference: 1180,
      subtotal_reference: 1000,
    }),
    1180,
  );
  assert.equal(resolveIncomeInvoiceOriginalAmount({ subtotal_reference: 1000 }), 1000);
  assert.equal(resolveIncomeInvoiceOriginalAmount(null), 0);
});

test('only tax_invoice is supported for INV-5A allocation', () => {
  assert.equal(isSupportedIncomePaymentDocumentType('tax_invoice'), true);
  assert.equal(isSupportedIncomePaymentDocumentType('quote'), false);
  assert.equal(isSupportedIncomePaymentDocumentType('receipt'), false);
});

test('payment method labels are Hebrew', () => {
  assert.equal(incomePaymentMethodLabel(parseIncomePaymentMethodKey('bank_transfer')), 'העברה בנקאית');
});

test('no payment_status column added to income_documents migrations', () => {
  const mig122 = readFileSync(
    join(dir, '../../../../supabase/migrations/122_income_documents_inc4.sql'),
    'utf8',
  );
  const mig148 = readFileSync(
    join(dir, '../../../../supabase/migrations/148_accounting_base_payment_allocation_foundation.sql'),
    'utf8',
  );
  assert.doesNotMatch(mig122, /payment_status/);
  assert.doesNotMatch(mig148, /payment_status/);
  assert.doesNotMatch(mig148, /alter table\s+public\.income_documents/i);
  assert.match(mig148, /accounting_payments/);
  assert.match(mig148, /accounting_payment_allocations/);
  assert.match(mig148, /accounting_base\.payment\.write/);
});

test('command service does not write payment_status onto income_documents', () => {
  const src = readFileSync(
    join(
      dir,
      '../../src/domains/accounting-base/accounting-base-income-payment.service.ts',
    ),
    'utf8',
  );
  assert.doesNotMatch(src, /payment_status/);
  assert.match(src, /emitIncomeWorkEventAfterInvoicePaidOrPartial/);
  assert.match(src, /loadActiveIncomeIssuerScope/);
});

test('payment+allocation write uses atomic SECURITY DEFINER RPC (no delete compensation)', () => {
  const mig148 = readFileSync(
    join(dir, '../../../../supabase/migrations/148_accounting_base_payment_allocation_foundation.sql'),
    'utf8',
  );
  const src = readFileSync(
    join(
      dir,
      '../../src/domains/accounting-base/accounting-base-income-payment.service.ts',
    ),
    'utf8',
  );
  assert.match(mig148, /create or replace function public\.accounting_base_record_and_allocate_income_payment/);
  assert.match(mig148, /language plpgsql/);
  assert.match(mig148, /security definer/);
  assert.match(mig148, /for update/i);
  assert.match(mig148, /raise exception 'Concurrent payment exceeded remaining balance'/);
  assert.match(src, /accounting_base_record_and_allocate_income_payment/);
  assert.match(src, /\.rpc\(/);
  assert.match(src, /callRecordAndAllocateIncomePaymentRpc/);
  // Must not rely on app-layer delete compensation as primary consistency.
  assert.doesNotMatch(src, /\.from\('accounting_payments'\)\s*\n?\s*\.delete\(/);
  assert.doesNotMatch(src, /\.from\('accounting_payment_allocations'\)\s*\n?\s*\.delete\(/);
  assert.doesNotMatch(src, /\.from\('accounting_payments'\)\s*\n?\s*\.insert\(/);
  assert.doesNotMatch(src, /\.from\('accounting_payment_allocations'\)\s*\n?\s*\.insert\(/);
});
