/**
 * P0 — Work Engine / Income client panel "לא שולם" uses Accounting Base remaining.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveIncomeInvoiceOriginalAmount,
  resolveIncomeInvoicePaymentState,
} from '../../src/domains/accounting-base/accounting-base-income-payment.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const mig157 = readFileSync(
  join(dir, '../../../../supabase/migrations/157_income_client_document_management_panel_unpaid_ab.sql'),
  'utf8',
);
const panelSource = readFileSync(
  join(dir, '../../src/domains/income/income-client-document-management-panel.service.ts'),
  'utf8',
);
const webPanel = readFileSync(
  join(dir, '../../../web/src/components/income/IncomeClientDocumentManagementPanel.tsx'),
  'utf8',
);
const invoicesTab = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoices-tab.read-model.service.ts'),
  'utf8',
);

test('canonical AB math: 8399 original − 590 paid → remaining 7809 partial', () => {
  const original = resolveIncomeInvoiceOriginalAmount({
    grand_total_reference: 8399,
  });
  assert.equal(original, 8399);
  const state = resolveIncomeInvoicePaymentState(original, 590);
  assert.equal(state.paid_amount ?? undefined, undefined);
  assert.equal(state.remaining_balance, 7809);
  assert.equal(state.payment_state_key, 'partial');
  const paid = resolveIncomeInvoicePaymentState(8399, 8399);
  assert.equal(paid.remaining_balance, 0);
  assert.equal(paid.payment_state_key, 'paid');
  // Second payment of remaining 7809 → paid
  const afterSecond = resolveIncomeInvoicePaymentState(8399, 590 + 7809);
  assert.equal(afterSecond.remaining_balance, 0);
  assert.equal(afterSecond.payment_state_key, 'paid');
});

test('migration 157 unpaid_reference subtracts effective posted allocations via AB helper', () => {
  assert.match(mig157, /accounting_base_income_invoice_original_amount/);
  assert.match(mig157, /accounting_payment_allocations/);
  assert.match(mig157, /status = 'posted'/);
  assert.match(mig157, /reversal_of_allocation_id is null/);
  assert.match(mig157, /greatest\(/);
  assert.match(mig157, /unpaid_reference/);
  // Must not keep legacy sum of raw snapshot totals as unpaid truth.
  assert.doesNotMatch(
    mig157,
    /sum\(case when collection_amount_reference > 0 then collection_amount_reference/,
  );
});

test('migration 163 unpaid_reference also subtracts issued Credit Note totals', () => {
  const mig163 = readFileSync(
    join(dir, '../../../../supabase/migrations/163_income_client_panel_unpaid_subtract_issued_credits.sql'),
    'utf8',
  );
  assert.match(mig163, /income_document_credit_links/);
  assert.match(mig163, /status = 'issued'/);
  assert.match(mig163, /credited_amount_reference/);
  assert.match(mig163, /credited_amount/);
  assert.match(
    mig163,
    /round\(oi\.original_amount, 2\)\s*-\s*round\(coalesce\(p\.paid_amount[\s\S]*-\s*round\(coalesce\(c\.credited_amount/,
  );
  assert.doesNotMatch(mig163, /discount_amount_reference/);
});

test('UI לא שולם binds unpaid_amount_display only (no FE original-paid math)', () => {
  assert.match(webPanel, /unpaid_amount_display/);
  assert.doesNotMatch(webPanel, /original_amount\s*-\s*paid/);
  assert.doesNotMatch(webPanel, /grand_total.*allocated|allocated.*grand_total/);
  assert.match(panelSource, /unpaid_amount_display/);
  assert.match(panelSource, /label: 'לא שולם'/);
  assert.match(panelSource, /166_income_client_panel_stats_exclude_end_customer_docs/);
});

test('Work Engine invoices tab composes client panel (לא שולם surface)', () => {
  assert.match(invoicesTab, /buildIncomeClientDocumentManagementPanel/);
  assert.match(invoicesTab, /client_document_management_panel/);
});
