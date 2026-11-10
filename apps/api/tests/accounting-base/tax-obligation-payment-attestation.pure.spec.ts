/**
 * Accounting Base tax-obligation payment attestation — classification helpers.
 * Attestation is user-attested, never bank-verified, and does not invent amounts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCOUNTING_BASE_COMMAND_ATTEST_TAX_OBLIGATION_PAYMENT,
  isTaxObligationPaymentClassification,
  paymentClassificationIsOutstanding,
  paymentClassificationIsSettled,
} from '../../src/domains/accounting-base/accounting-base-tax-obligation-payment.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));

test('payment classifications distinguish outstanding vs settled without inventing amounts', () => {
  assert.equal(isTaxObligationPaymentClassification('paid_in_full'), true);
  assert.equal(isTaxObligationPaymentClassification('outstanding'), true);
  assert.equal(isTaxObligationPaymentClassification('partially_paid'), true);
  assert.equal(isTaxObligationPaymentClassification('not_required'), true);
  assert.equal(isTaxObligationPaymentClassification('bank_verified'), false);
  assert.equal(paymentClassificationIsOutstanding('outstanding'), true);
  assert.equal(paymentClassificationIsOutstanding('partially_paid'), true);
  assert.equal(paymentClassificationIsOutstanding('paid_in_full'), false);
  assert.equal(paymentClassificationIsSettled('paid_in_full'), true);
  assert.equal(paymentClassificationIsSettled('not_required'), true);
  assert.equal(ACCOUNTING_BASE_COMMAND_ATTEST_TAX_OBLIGATION_PAYMENT, 'attest_tax_obligation_payment');
});

test('attestation service never posts a ledger or marks bank_verified', () => {
  const service = readFileSync(
    join(dir, '../../src/domains/accounting-base/accounting-base-tax-obligation-payment.service.ts'),
    'utf8',
  );
  assert.match(service, /bank_verified: false/);
  assert.match(service, /amount_paid: null/);
  assert.match(service, /amount_remaining: null/);
  assert.doesNotMatch(service, /from\('accounting_entries'\)/);
  assert.match(service, /ACCOUNTING_BASE_TAX_OBLIGATION_PAYMENT_ATTESTED/);
});
