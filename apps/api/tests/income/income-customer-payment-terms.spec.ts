import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDueDateFromPaymentTerms,
  incomeCustomerPaymentTermsLabel,
  resolveIncomeDueDateFromDocument,
  resolveTaxInvoiceDueDate,
  resolveTaxInvoiceDueDateForIssue,
} from '../../src/domains/income/income-customer-payment-terms.pure.js';

test('payment terms labels match Hebrew options', () => {
  assert.equal(incomeCustomerPaymentTermsLabel('immediate'), 'מיידי');
  assert.equal(incomeCustomerPaymentTermsLabel('eom_plus_30'), 'שוטף + 30');
  assert.equal(incomeCustomerPaymentTermsLabel('eom_plus_60'), 'שוטף + 60');
  assert.equal(incomeCustomerPaymentTermsLabel('eom_plus_90'), 'שוטף + 90');
});

test('computeDueDateFromPaymentTerms — מיידי uses document date', () => {
  assert.equal(computeDueDateFromPaymentTerms('2026-03-15', 'immediate'), '2026-03-15');
});

test('computeDueDateFromPaymentTerms — שוטף + 30 is end of month + 30 days', () => {
  assert.equal(computeDueDateFromPaymentTerms('2026-03-15', 'eom_plus_30'), '2026-04-30');
  assert.equal(computeDueDateFromPaymentTerms('2026-01-10', 'eom_plus_30'), '2026-03-02');
});

test('resolveTaxInvoiceDueDate respects manual override', () => {
  assert.equal(
    resolveTaxInvoiceDueDate({
      documentDateIso: '2026-03-15',
      paymentTerms: 'eom_plus_30',
      storedDueDate: '2026-05-01',
      dueDateManualOverride: true,
    }),
    '2026-05-01',
  );
  assert.equal(
    resolveTaxInvoiceDueDate({
      documentDateIso: '2026-03-15',
      paymentTerms: 'eom_plus_30',
      storedDueDate: '2026-05-01',
      dueDateManualOverride: false,
    }),
    '2026-04-30',
  );
});

test('issue persists the due date shown on the tax invoice document', () => {
  assert.equal(
    resolveTaxInvoiceDueDateForIssue({
      storedDueDate: null,
      documentDateIso: '2026-08-07',
      paymentTerms: 'eom_plus_30',
      dueDateManualOverride: false,
    }),
    '2026-09-30',
  );
  assert.equal(
    resolveTaxInvoiceDueDateForIssue({
      storedDueDate: '2026-10-15',
      documentDateIso: '2026-08-07',
      paymentTerms: 'eom_plus_30',
      dueDateManualOverride: true,
    }),
    '2026-10-15',
  );
});

test('issued display recovers document due date from payment terms when stored due_date is null', () => {
  assert.equal(
    resolveIncomeDueDateFromDocument({
      storedDueDate: null,
      documentDateIso: '2026-08-07',
      paymentTerms: 'eom_plus_30',
    }),
    '2026-09-30',
  );
  assert.equal(
    resolveIncomeDueDateFromDocument({
      storedDueDate: '2026-09-19',
      documentDateIso: '2026-08-07',
      paymentTerms: 'eom_plus_30',
    }),
    '2026-09-19',
  );
  assert.equal(
    resolveIncomeDueDateFromDocument({
      storedDueDate: null,
      documentDateIso: '2026-08-07',
      paymentTerms: null,
    }),
    null,
  );
});
