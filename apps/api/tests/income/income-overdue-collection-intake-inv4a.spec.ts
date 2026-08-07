/**
 * INV-4A — overdue detection → Work Engine collection intake tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INCOME_OVERDUE_SCAN_MAX_PAGES,
  INCOME_OVERDUE_SCAN_PAGE_SIZE,
  INCOME_WORK_EVENT_OVERDUE,
  incomeDocumentPeriodKey,
  incomeInvoiceCollectionPeriodKey,
  isInvoiceCollectionDocumentType,
  resolveIncomeWorkEngineClientId,
} from '../../src/domains/income/income-work-engine-bridge.pure.js';
import { resolveIncomeOverdueCollectionIntake } from '../../src/domains/income/invoice-lifecycle.pure.js';
import { resolveEventMapping } from '../../src/domains/work-engine/work-engine.event-mapping.service.js';
import { isSupportedIncomePaymentDocumentType } from '../../src/domains/accounting-base/accounting-base-income-payment.pure.js';

/** Mirrors work-engine.guards PERIOD_KEY_REGEX without importing supabase-backed guards. */
const PERIOD_KEY_REGEX = /^[a-z][a-z0-9_]*:[a-z0-9][a-z0-9_:-]*$/;

const dir = dirname(fileURLToPath(import.meta.url));
const bridgeSource = readFileSync(
  join(dir, '../../src/domains/income/income-work-engine-bridge.ts'),
  'utf8',
);
const pureSource = readFileSync(
  join(dir, '../../src/domains/income/income-work-engine-bridge.pure.ts'),
  'utf8',
);
const lifecycleSource = readFileSync(
  join(dir, '../../src/domains/income/invoice-lifecycle.pure.ts'),
  'utf8',
);
const mappingSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.event-mapping.service.ts'),
  'utf8',
);
const dedupDoc = readFileSync(
  join(dir, '../../../../docs/work-engine-dedup-policy.md'),
  'utf8',
);

const TODAY = '2026-08-07';
const DOC_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

test('INV-4A A: due future unpaid → not eligible', () => {
  const r = resolveIncomeOverdueCollectionIntake({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: '2026-08-20',
    originalAmount: 1000,
    paidAmount: 0,
    todayIso: TODAY,
  });
  assert.equal(r.eligible, false);
});

test('INV-4A B: due yesterday unpaid → eligible', () => {
  const r = resolveIncomeOverdueCollectionIntake({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: '2026-08-06',
    originalAmount: 1000,
    paidAmount: 0,
    todayIso: TODAY,
  });
  assert.equal(r.eligible, true);
  assert.equal(r.payment_state_key, 'unpaid');
  assert.equal(r.remaining_balance, 1000);
  assert.equal(r.overdue_since, '2026-08-06');
});

test('INV-4A C: partial overdue → eligible', () => {
  const r = resolveIncomeOverdueCollectionIntake({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: '2026-07-01',
    originalAmount: 1000,
    paidAmount: 400,
    todayIso: TODAY,
  });
  assert.equal(r.eligible, true);
  assert.equal(r.payment_state_key, 'partial');
  assert.equal(r.remaining_balance, 600);
});

test('INV-4A D: paid past due → not eligible', () => {
  const r = resolveIncomeOverdueCollectionIntake({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: '2026-07-01',
    originalAmount: 1000,
    paidAmount: 1000,
    todayIso: TODAY,
  });
  assert.equal(r.eligible, false);
  assert.equal(r.payment_state_key, 'paid');
});

test('INV-4A E: no due date → not eligible', () => {
  const r = resolveIncomeOverdueCollectionIntake({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: null,
    originalAmount: 1000,
    paidAmount: 0,
    todayIso: TODAY,
  });
  assert.equal(r.eligible, false);
});

test('INV-4A F: unsupported collectible types excluded from intake', () => {
  assert.equal(isInvoiceCollectionDocumentType('deal_invoice'), true);
  assert.equal(isSupportedIncomePaymentDocumentType('deal_invoice'), false);
  assert.equal(isSupportedIncomePaymentDocumentType('tax_invoice_receipt'), false);
  for (const t of ['deal_invoice', 'tax_invoice_receipt', 'quote'] as const) {
    const r = resolveIncomeOverdueCollectionIntake({
      documentStatus: 'issued',
      documentType: t,
      dueDate: '2026-07-01',
      originalAmount: 1000,
      paidAmount: 0,
      todayIso: TODAY,
    });
    assert.equal(r.eligible, false, t);
  }
  assert.match(bridgeSource, /\.eq\('document_type', 'tax_invoice'\)/);
  assert.match(lifecycleSource, /isSupportedIncomePaymentDocumentType/);
});

test('INV-4A G: period_key per invoice + regex valid (no client-month collapse)', () => {
  const pk = incomeInvoiceCollectionPeriodKey(DOC_ID);
  assert.equal(pk, `invoice:${DOC_ID}`);
  assert.ok(PERIOD_KEY_REGEX.test(pk));
  assert.match(pureSource, /per-invoice collection period key/i);
  assert.match(bridgeSource, /incomeInvoiceCollectionPeriodKey/);
  // Global WE dedup still (org,client,module,work_type,period_key) — invoice:id makes it per invoice.
  assert.match(dedupDoc, /source_entity_id/);
});

test('INV-4A H/I: failure does not mark processed; retry via next scan', () => {
  assert.match(bridgeSource, /auditBridgeFailure/);
  assert.match(bridgeSource, /return null/);
  assert.doesNotMatch(bridgeSource, /processed_overdue|overdue_emitted_at|skip.*success/);
  assert.match(bridgeSource, /sumPostedAllocationsForIncomeDocuments/);
});

test('INV-4A J: self-mode skipped; office represented_client required', () => {
  assert.equal(resolveIncomeWorkEngineClientId(null), null);
  assert.match(bridgeSource, /\.not\('represented_client_id', 'is', null\)/);
  assert.match(bridgeSource, /self-mode skipped/);
});

test('INV-4A K/L: ordered pagination catch-up beyond 200', () => {
  assert.equal(INCOME_OVERDUE_SCAN_PAGE_SIZE, 200);
  assert.ok(INCOME_OVERDUE_SCAN_MAX_PAGES >= 2);
  assert.match(bridgeSource, /\.range\(from, to\)/);
  assert.match(bridgeSource, /INCOME_OVERDUE_SCAN_MAX_PAGES/);
  assert.match(bridgeSource, /order\('due_date'/);
  assert.match(bridgeSource, /order\('id'/);
  const capacity = INCOME_OVERDUE_SCAN_PAGE_SIZE * INCOME_OVERDUE_SCAN_MAX_PAGES;
  assert.ok(capacity >= 400, 'must process >200 candidates across pages');
});

test('INV-4A M: no legacy unpaid source', () => {
  assert.doesNotMatch(bridgeSource, /unpaid_reference|unpaid_amount_reference|TEMPORARY_ACCOUNTING_BASE_PENDING/);
  assert.match(bridgeSource, /resolveIncomeOverdueCollectionIntake/);
  assert.match(bridgeSource, /resolveIncomeInvoiceOriginalAmount/);
});

test('INV-4A N: event contract + WE mapping', () => {
  assert.equal(INCOME_WORK_EVENT_OVERDUE, 'income.invoice_overdue');
  const mapped = resolveEventMapping({
    event_type: 'income.invoice_overdue',
    period_key: incomeInvoiceCollectionPeriodKey(DOC_ID),
  });
  assert.equal(mapped.resolved, true);
  if (mapped.resolved) {
    assert.equal(mapped.work_type, 'invoice_collection_followup');
    assert.equal(mapped.initial_state, 'waiting_client');
  }
  assert.match(mappingSource, /invoice_collection_followup/);
  assert.match(bridgeSource, /remaining_balance_reference/);
  assert.match(bridgeSource, /payment_state_key/);
  assert.match(bridgeSource, /intakeWorkEvent/);
  assert.doesNotMatch(bridgeSource, /\.from\(['"]work_items['"]\)/);
});

test('INV-4A month period_key also matches WE regex', () => {
  assert.equal(incomeDocumentPeriodKey('2026-05-10'), 'month:2026-05');
  assert.ok(PERIOD_KEY_REGEX.test(incomeDocumentPeriodKey('2026-05-10')));
});

test('INV-4A future gap: paid→reverse→overdue again documented', () => {
  assert.match(pureSource, /per-invoice/);
  // Reopen after paid close is INV-4+; period_key invoice:id stays same episode identity.
  assert.doesNotMatch(bridgeSource, /reopen.*collection|collection.*reopen/i);
});
