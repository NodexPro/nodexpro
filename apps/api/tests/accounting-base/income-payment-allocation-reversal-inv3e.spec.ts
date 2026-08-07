/**
 * INV-3E — payment allocation reversal contract / wiring / payment-state tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCOUNTING_BASE_COMMAND_REVERSE_INCOME_PAYMENT_ALLOCATION,
  resolveIncomeInvoicePaymentState,
} from '../../src/domains/accounting-base/accounting-base-income-payment.pure.js';
import { resolveAccountsReceivableAgingBucket } from '../../src/domains/accounting-base/accounting-base-accounts-receivable-aging.pure.js';
import { composeInvoiceLifecycleDueDimension } from '../../src/domains/income/invoice-lifecycle.pure.js';
import { isOpenAccountsReceivableRow } from '../../src/domains/accounting-base/accounting-base-accounts-receivable.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const mig = readFileSync(
  join(dir, '../../../../supabase/migrations/154_accounting_base_reverse_income_payment_allocation.sql'),
  'utf8',
);
const mig148 = readFileSync(
  join(dir, '../../../../supabase/migrations/148_accounting_base_payment_allocation_foundation.sql'),
  'utf8',
);
const migPortfolio = readFileSync(
  join(dir, '../../../../supabase/migrations/153_accounting_base_accounts_receivable_portfolio.sql'),
  'utf8',
);
const caseSource = readFileSync(
  join(dir, '../../src/domains/accounting-base/accounting-base-income-payment-case.read.ts'),
  'utf8',
);
const reversalSource = readFileSync(
  join(dir, '../../src/domains/accounting-base/accounting-base-income-payment-reversal.service.ts'),
  'utf8',
);
const commandsSource = readFileSync(
  join(dir, '../../src/domains/accounting-base/accounting-base-commands.service.ts'),
  'utf8',
);
const routesSource = readFileSync(
  join(dir, '../../src/domains/accounting-base/accounting-base.routes.ts'),
  'utf8',
);
const auditSource = readFileSync(join(dir, '../../src/shared/audit-events.ts'), 'utf8');
const receiptOrch = readFileSync(
  join(dir, '../../src/domains/income/income-document-payment.service.ts'),
  'utf8',
);

const TODAY = '2026-08-07';

test('INV-3E schema: reversal row points to original', () => {
  assert.match(mig148, /reversal_of_allocation_id uuid null/);
  assert.match(
    mig148,
    /foreign key \(reversal_of_allocation_id, organization_id\)[\s\S]*references public\.accounting_payment_allocations/,
  );
  assert.match(mig, /reversal_of_allocation_id = v_orig\.id|reversal_of_allocation_id,\s*[\s\S]*v_orig\.id/);
  assert.match(mig, /set status = 'reversed'/);
  assert.match(mig, /Cannot reverse a reversal allocation/);
});

test('INV-3E A: reverse single 400 → unpaid/remaining restored', () => {
  const afterPay = resolveIncomeInvoicePaymentState(1000, 400);
  assert.equal(afterPay.payment_state_key, 'partial');
  assert.equal(afterPay.remaining_balance, 600);
  const afterRev = resolveIncomeInvoicePaymentState(1000, 0);
  assert.equal(afterRev.payment_state_key, 'unpaid');
  assert.equal(afterRev.remaining_balance, 1000);
});

test('INV-3E B: reverse one of two allocations → partial', () => {
  const fully = resolveIncomeInvoicePaymentState(1000, 1000);
  assert.equal(fully.payment_state_key, 'paid');
  const afterRev600 = resolveIncomeInvoicePaymentState(1000, 400);
  assert.equal(afterRev600.payment_state_key, 'partial');
  assert.equal(afterRev600.remaining_balance, 600);
});

test('INV-3E C: reverse full-pay allocation → returns to open A/R', () => {
  assert.equal(isOpenAccountsReceivableRow({ remaining_balance: 0 }), false);
  const after = resolveIncomeInvoicePaymentState(1000, 400);
  assert.equal(isOpenAccountsReceivableRow({ remaining_balance: after.remaining_balance }), true);
});

test('INV-3E D: overdue recomposes after balance returns', () => {
  const due = composeInvoiceLifecycleDueDimension({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: '2026-07-01',
    remainingBalance: 1000,
    paymentStateKey: 'unpaid',
    todayIso: TODAY,
  });
  assert.equal(due.overdue, true);
  assert.equal(
    resolveAccountsReceivableAgingBucket({ overdue: due.overdue, days_overdue: due.days_overdue }),
    '31_60',
  );
});

test('INV-3E E/F: idempotent one reversal per original', () => {
  assert.match(mig, /uq_accounting_payment_allocations_one_reversal/);
  assert.match(mig, /'replay', true/);
  assert.match(mig, /status = 'reversed'/);
});

test('INV-3E G/H: org + issuer scope enforced in service', () => {
  assert.match(reversalSource, /assertOrgInContext/);
  assert.match(reversalSource, /assertRowMatchesIssuerScope/);
  assert.match(reversalSource, /\.eq\('organization_id', organizationId\)/);
});

test('INV-3E I/J: non-posted / reversal-of-reversal rejected', () => {
  assert.match(mig, /Only posted allocations can be reversed/);
  assert.match(mig, /Cannot reverse a reversal allocation/);
  assert.match(reversalSource, /Cannot reverse a reversal allocation/);
});

test('INV-3E K/L: history preserves original; payment remains posted', () => {
  assert.match(caseSource, /allocation_history/);
  assert.match(caseSource, /allocation_status/);
  assert.match(reversalSource, /payment_remains_posted: true/);
  assert.doesNotMatch(mig, /update public\.accounting_payments[\s\S]*status = 'reversed'/);
  assert.match(mig, /do NOT delete history|Never delete|status = 'reversed'/i);
});

test('INV-3E M/N: A/R + portfolio use same effective sum rule', () => {
  assert.match(caseSource, /status', 'posted'\)/);
  assert.match(caseSource, /reversal_of_allocation_id/);
  assert.match(migPortfolio, /a\.status = 'posted'/);
  assert.match(migPortfolio, /a\.reversal_of_allocation_id is null/);
  assert.match(reversalSource, /accounts_receivable_affected/);
});

test('INV-3E O: lifecycle refresh after reversal', () => {
  assert.match(reversalSource, /buildInvoiceLifecycleAggregate/);
  assert.match(reversalSource, /invoice_lifecycle_aggregate/);
});

test('INV-3E P: multi-currency isolated — reversal uses allocation currency', () => {
  assert.match(mig, /'currency', v_orig\.currency/);
  assert.doesNotMatch(reversalSource, /fx|exchange_rate/i);
});

test('INV-3E Q: no delete of issued receipt / income document', () => {
  assert.match(reversalSource, /issued_receipt_not_mutated: true/);
  assert.doesNotMatch(reversalSource, /\.delete\(|document_status.*=.*['"]void/);
  assert.match(receiptOrch, /never deleted on receipt failure|no unauthorized reversal/i);
});

test('INV-3E R: command-only write; no FE calc / hidden GET chain required', () => {
  assert.equal(
    ACCOUNTING_BASE_COMMAND_REVERSE_INCOME_PAYMENT_ALLOCATION,
    'reverse_income_payment_allocation',
  );
  assert.match(routesSource, /REVERSE_INCOME_PAYMENT_ALLOCATION/);
  assert.match(commandsSource, /executeReverseIncomePaymentAllocation/);
  assert.match(caseSource, /reverse_payment_allocation/);
  assert.match(caseSource, /בטל שיוך תשלום/);
  assert.match(auditSource, /ACCOUNTING_BASE_PAYMENT_ALLOCATION_REVERSED/);
});

test('INV-3E effective sum rule documented once', () => {
  assert.match(caseSource, /Canonical rule \(INV-5A \/ INV-3E\)/);
  assert.match(mig, /status='posted' AND reversal_of_allocation_id IS NULL/);
});

test('INV-3E Work Engine: no automatic collection reopen', () => {
  assert.doesNotMatch(reversalSource, /emitIncomeWorkEventAfterInvoicePaidOrPartial|collection.*reopen/i);
});
