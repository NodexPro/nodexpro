import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INCOME_COMMAND_RECORD_DOCUMENT_PAYMENT,
  buildIncomeDocumentRecordPaymentForm,
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

test('migration 150 adds org immutability triggers reusing existing guard function', () => {
  const mig150 = readFileSync(
    join(dir, '../../../../supabase/migrations/150_income_document_payment_org_immutability.sql'),
    'utf8',
  );
  assert.match(mig150, /income_document_links_org_immutable/);
  assert.match(mig150, /income_document_payment_operations_org_immutable/);
  assert.match(
    mig150,
    /execute function public\.accounting_base_guard_org_immutable\(\)/,
  );
  assert.equal(
    (mig150.match(/execute function public\.accounting_base_guard_org_immutable\(\)/g) ?? [])
      .length,
    2,
  );
  assert.doesNotMatch(mig150, /create or replace function/i);
  assert.doesNotMatch(mig150, /create function/i);
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

test('INV-5C payment form fields and required flags come from backend helper', () => {
  const form = buildIncomeDocumentRecordPaymentForm({
    incomeDocumentId: 'doc-1',
    currency: 'ils',
    remainingBalance: 1234.5,
    enabled: true,
    disabledReason: null,
    paymentDateDefault: '2026-08-01',
  });
  assert.equal(form.command, INCOME_COMMAND_RECORD_DOCUMENT_PAYMENT);
  assert.equal(form.title, 'רישום תשלום');
  assert.equal(form.enabled, true);
  const byKey = new Map(form.fields.map((f) => [f.key, f]));
  assert.equal(byKey.get('amount')?.required, true);
  assert.equal(byKey.get('amount')?.default_value, '1234.5');
  assert.equal(byKey.get('payment_date')?.required, true);
  assert.equal(byKey.get('payment_method_key')?.required, true);
  assert.equal(byKey.get('reference_number')?.required, false);
  assert.equal(byKey.get('bank_key')?.required, false);
  assert.equal(byKey.get('bank_branch')?.required, false);
  assert.equal(byKey.get('bank_account')?.required, false);
  assert.equal(byKey.get('note')?.required, false);
  assert.equal(byKey.get('currency')?.type, 'hidden');
  assert.equal(byKey.get('currency')?.default_value, 'ILS');
});

test('by-type aggregate embeds payment columns and record_payment for tax invoices', () => {
  const src = readFileSync(
    join(
      dir,
      '../../src/domains/work-engine/work-engine-invoices-client-documents-by-type.read-model.service.ts',
    ),
    'utf8',
  );
  assert.match(src, /TAX_INVOICE_TABLE_COLUMNS/);
  assert.match(src, /record_payment/);
  assert.match(src, /buildIncomeDocumentRecordPaymentForm/);
  assert.match(src, /sumPostedAllocationsForIncomeDocuments/);
  assert.match(src, /payment_state_icon/);
});

test('payment case response embeds documents list + invoices tab for zero post-command GETs', () => {
  const caseSrc = readFileSync(
    join(dir, '../../src/domains/income/income-document-payment-case.read.ts'),
    'utf8',
  );
  assert.match(caseSrc, /work_engine_invoices_client_documents_by_type_aggregate/);
  assert.match(caseSrc, /work_engine_invoices_tab_aggregate/);
  assert.match(caseSrc, /source_invoice_row/);
  assert.match(caseSrc, /buildWorkEngineInvoicesClientDocumentsByTypeAggregate/);
  assert.match(caseSrc, /buildWorkEngineInvoicesTabAggregate/);

  const modalSrc = readFileSync(
    join(
      dir,
      '../../../web/src/components/work-engine/WorkEngineClientDocumentsByTypeModal.tsx',
    ),
    'utf8',
  );
  const paymentOnAfter = modalSrc.slice(
    modalSrc.indexOf('<IncomeDocumentRecordPaymentModal'),
    modalSrc.indexOf('/>', modalSrc.indexOf('<IncomeDocumentRecordPaymentModal')) + 2,
  );
  assert.match(paymentOnAfter, /work_engine_invoices_client_documents_by_type_aggregate/);
  assert.match(paymentOnAfter, /onInvoicesTabRefresh/);
  assert.doesNotMatch(paymentOnAfter, /loadAggregate/);
  assert.doesNotMatch(paymentOnAfter, /refreshInvoicesTabFromCommand/);
  assert.doesNotMatch(paymentOnAfter, /fetchWorkEngine/);
});
