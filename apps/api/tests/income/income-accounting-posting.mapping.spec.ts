import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  extractPostingAmountFromTotals,
  resolveAccountingDisplayStatus,
  resolveIncomeAccountingPostingPlan,
} from '../../src/domains/income/income-accounting-posting.mapping.js';

const dir = dirname(fileURLToPath(import.meta.url));
const postingServiceSource = readFileSync(
  join(dir, '../../src/domains/accounting-base/income-document-posting.service.ts'),
  'utf8',
);
const incomePostingSource = readFileSync(
  join(dir, '../../src/domains/income/income-accounting-posting.service.ts'),
  'utf8',
);

test('tax_invoice posts receivable income credit entry', () => {
  const plan = resolveIncomeAccountingPostingPlan('tax_invoice');
  assert.equal(plan.requires_posting, true);
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0]?.entry_type, 'income');
  assert.equal(plan.entries[0]?.direction, 'credit');
  assert.equal(plan.entries[0]?.role, 'receivable');
});

test('receipt posts payment received income credit entry', () => {
  const plan = resolveIncomeAccountingPostingPlan('receipt');
  assert.equal(plan.requires_posting, true);
  assert.equal(plan.entries[0]?.role, 'payment_received');
  assert.equal(plan.entries[0]?.direction, 'credit');
});

test('tax_invoice_receipt uses single combined entry (no duplicate money)', () => {
  const plan = resolveIncomeAccountingPostingPlan('tax_invoice_receipt');
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0]?.role, 'combined_invoice_receipt');
});

test('credit_tax_invoice posts refund debit non-negative amount model', () => {
  const plan = resolveIncomeAccountingPostingPlan('credit_tax_invoice');
  assert.equal(plan.entries[0]?.entry_type, 'refund');
  assert.equal(plan.entries[0]?.direction, 'debit');
});

test('quote does not require Accounting Base posting', () => {
  const plan = resolveIncomeAccountingPostingPlan('quote');
  assert.equal(plan.requires_posting, false);
  assert.equal(plan.display_status_when_skipped, 'not_posted_quote');
  assert.equal(resolveAccountingDisplayStatus('quote', 'not_required'), 'not_posted_quote');
});

test('deal_invoice does not finalize Accounting Base truth', () => {
  const plan = resolveIncomeAccountingPostingPlan('deal_invoice');
  assert.equal(plan.requires_posting, false);
  assert.equal(plan.display_status_when_skipped, 'not_posted_non_final_document');
});

test('extractPostingAmountFromTotals sums line amount_reference', () => {
  const amount = extractPostingAmountFromTotals(null, [
    { amount_reference: 100 },
    { amount_reference: 50 },
  ]);
  assert.equal(amount, 150);
});

test('Accounting Base posting service uses forCommandCreateEntry not raw inserts', () => {
  assert.match(postingServiceSource, /forCommandCreateEntry/);
  assert.match(postingServiceSource, /forCommandCreateLink/);
  assert.doesNotMatch(postingServiceSource, /\.from\('accounting_entries'\)\.insert/);
});

test('income posting integration has no Work Engine / DocFlow imports', () => {
  assert.doesNotMatch(incomePostingSource, /from\s+['"].*work-engine/i);
  assert.doesNotMatch(incomePostingSource, /from\s+['"].*docflow/i);
});

test('idempotency via findExistingPosting in accounting posting service', () => {
  assert.match(postingServiceSource, /findExistingPosting/);
  assert.match(postingServiceSource, /buildAccountingPostingSignature/);
});
