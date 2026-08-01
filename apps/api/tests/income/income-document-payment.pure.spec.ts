import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INCOME_COMMAND_RECORD_DOCUMENT_PAYMENT,
  buildIncomePaymentReceiptDetailsText,
  resolvePaymentStateIcon,
} from '../../src/domains/income/income-document-payment.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));

test('Hebrew receipt details text for partial and full payment', () => {
  assert.equal(
    buildIncomePaymentReceiptDetailsText({ invoiceNumber: '10045', isPartial: true }),
    'תשלום חלקי עבור חשבונית מס מס׳ 10045',
  );
  assert.equal(
    buildIncomePaymentReceiptDetailsText({ invoiceNumber: '10045', isPartial: false }),
    'תשלום עבור חשבונית מס מס׳ 10045',
  );
});

test('payment state icon is check only when paid', () => {
  assert.equal(resolvePaymentStateIcon('paid'), 'check');
  assert.equal(resolvePaymentStateIcon('partial'), null);
  assert.equal(resolvePaymentStateIcon('unpaid'), null);
});

test('command constant and no payment_status on income_documents in INV-5B migration', () => {
  assert.equal(INCOME_COMMAND_RECORD_DOCUMENT_PAYMENT, 'record_income_document_payment');
  const mig149 = readFileSync(
    join(dir, '../../../../supabase/migrations/149_income_document_payment_orchestration.sql'),
    'utf8',
  );
  assert.doesNotMatch(mig149, /payment_status/);
  assert.match(mig149, /income_document_links/);
  assert.match(mig149, /income_document_payment_operations/);
  assert.match(mig149, /payment_receipt_for_invoice/);
});

test('orchestration service reuses AB allocation and issue pipeline', () => {
  const src = readFileSync(
    join(dir, '../../src/domains/income/income-document-payment.service.ts'),
    'utf8',
  );
  assert.match(src, /executeRecordAndAllocateIncomePayment/);
  assert.match(src, /executeIssueIncomeDocument/);
  assert.doesNotMatch(src, /payment_status/);
  assert.doesNotMatch(src, /work_items/);
  assert.match(src, /payment_allocated/);
  assert.match(src, /Consistency strategy/);
});
