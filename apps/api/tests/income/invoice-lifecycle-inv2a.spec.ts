/**
 * INV-2A — invoice lifecycle composer tests (pure dimensions + architecture proofs).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveIncomeInvoicePaymentState } from '../../src/domains/accounting-base/accounting-base-income-payment.pure.js';
import {
  composeInvoiceLifecycleDeliveryDimension,
  composeInvoiceLifecycleDueDimension,
  composeInvoiceLifecyclePaymentState,
} from '../../src/domains/income/invoice-lifecycle.pure.js';
import { INVOICE_LIFECYCLE_AGGREGATE_KEY } from '../../src/domains/income/invoice-lifecycle.types.js';

const dir = dirname(fileURLToPath(import.meta.url));
const pureSource = readFileSync(join(dir, '../../src/domains/income/invoice-lifecycle.pure.ts'), 'utf8');
const serviceSource = readFileSync(
  join(dir, '../../src/domains/income/invoice-lifecycle.read-model.service.ts'),
  'utf8',
);
const routesSource = readFileSync(join(dir, '../../src/domains/income/income.routes.ts'), 'utf8');
const migration122 = readFileSync(
  join(dir, '../../../../supabase/migrations/122_income_documents_inc4.sql'),
  'utf8',
);

const TODAY = '2026-08-07';

test('INV-2A A: issued + not_sent + unpaid + not_due → dimensions', () => {
  const delivery = composeInvoiceLifecycleDeliveryDimension([]);
  const payment = composeInvoiceLifecyclePaymentState(1000, 0);
  const due = composeInvoiceLifecycleDueDimension({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: '2026-08-20',
    remainingBalance: payment.remaining_balance,
    paymentStateKey: payment.payment_state_key,
    todayIso: TODAY,
  });
  assert.equal(delivery.state_key, 'not_sent');
  assert.equal(delivery.attempt_count, 0);
  assert.equal(payment.payment_state_key, 'unpaid');
  assert.equal(due.state_key, 'not_due');
  assert.equal(due.overdue, false);
});

test('INV-2A B: sent + unpaid + overdue', () => {
  const delivery = composeInvoiceLifecycleDeliveryDimension([
    {
      channel: 'email',
      result: 'sent',
      sentAt: '2026-07-01T10:00:00.000Z',
      createdAt: '2026-07-01T10:00:00.000Z',
    },
  ]);
  const payment = composeInvoiceLifecyclePaymentState(500, 0);
  const due = composeInvoiceLifecycleDueDimension({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: '2026-07-01',
    remainingBalance: payment.remaining_balance,
    paymentStateKey: payment.payment_state_key,
    todayIso: TODAY,
  });
  assert.equal(delivery.state_key, 'sent');
  assert.equal(payment.payment_state_key, 'unpaid');
  assert.equal(due.state_key, 'overdue');
  assert.equal(due.overdue, true);
  assert.equal(due.overdue_since, '2026-07-01');
  assert.ok((due.days_overdue ?? 0) > 0);
});

test('INV-2A C: partial + overdue', () => {
  const payment = composeInvoiceLifecyclePaymentState(1000, 400);
  const due = composeInvoiceLifecycleDueDimension({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: '2026-06-01',
    remainingBalance: payment.remaining_balance,
    paymentStateKey: payment.payment_state_key,
    todayIso: TODAY,
  });
  assert.equal(payment.payment_state_key, 'partial');
  assert.equal(payment.remaining_balance, 600);
  assert.equal(due.overdue, true);
});

test('INV-2A D: paid → due not_due even if collection would be active', () => {
  const payment = composeInvoiceLifecyclePaymentState(1000, 1000);
  const due = composeInvoiceLifecycleDueDimension({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: '2026-01-01',
    remainingBalance: payment.remaining_balance,
    paymentStateKey: payment.payment_state_key,
    todayIso: TODAY,
  });
  assert.equal(payment.payment_state_key, 'paid');
  assert.equal(due.state_key, 'not_due');
  assert.equal(due.overdue, false);
  assert.match(serviceSource, /collectionActive/);
  assert.match(serviceSource, /invoice_collection_followup/);
});

test('INV-2A E: prior sent + later failed → delivery remains sent + last_failure_at', () => {
  const delivery = composeInvoiceLifecycleDeliveryDimension([
    {
      channel: 'email',
      result: 'sent',
      sentAt: '2026-07-01T10:00:00.000Z',
      createdAt: '2026-07-01T10:00:00.000Z',
    },
    {
      channel: 'email',
      result: 'failed',
      sentAt: '2026-07-02T10:00:00.000Z',
      createdAt: '2026-07-02T10:00:00.000Z',
    },
  ]);
  assert.equal(delivery.state_key, 'sent');
  assert.equal(delivery.last_failure_at, '2026-07-02T10:00:00.000Z');
  assert.equal(delivery.last_success_at, '2026-07-01T10:00:00.000Z');
});

test('INV-2A F: only failed sends → delivery failed', () => {
  const delivery = composeInvoiceLifecycleDeliveryDimension([
    {
      channel: 'docflow',
      result: 'failed',
      sentAt: '2026-07-03T12:00:00.000Z',
      createdAt: '2026-07-03T12:00:00.000Z',
    },
  ]);
  assert.equal(delivery.state_key, 'failed');
  assert.equal(delivery.last_failure_at, '2026-07-03T12:00:00.000Z');
});

test('INV-2A G: no due date → not_applicable', () => {
  const due = composeInvoiceLifecycleDueDimension({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: null,
    remainingBalance: 100,
    paymentStateKey: 'unpaid',
    todayIso: TODAY,
  });
  assert.equal(due.state_key, 'not_applicable');
  assert.equal(due.overdue, false);
});

test('INV-2A H: cross-client rejected via assertRowMatchesIssuerScope', () => {
  assert.match(serviceSource, /assertRowMatchesIssuerScope/);
  assert.match(serviceSource, /loadActiveIncomeIssuerScope/);
});

test('INV-2A I: no payment rows → AB unpaid formula unchanged', () => {
  const viaLifecycle = composeInvoiceLifecyclePaymentState(250, 0);
  const viaAb = resolveIncomeInvoicePaymentState(250, 0);
  assert.deepEqual(viaLifecycle, viaAb);
  assert.equal(viaLifecycle.payment_state_key, 'unpaid');
  assert.equal(viaLifecycle.remaining_balance, 250);
  assert.match(serviceSource, /sumPostedAllocationsForIncomeDocument/);
  assert.match(serviceSource, /resolveIncomeInvoiceOriginalAmount/);
  assert.match(pureSource, /resolveIncomeInvoicePaymentState/);
});

test('INV-2A J: no collection item path leaves active=false', () => {
  assert.match(serviceSource, /const collectionActive = collectionItem != null/);
  assert.match(serviceSource, /active: collectionActive/);
  assert.match(serviceSource, /work_item_id: collectionItem\?\.work_item_id \?\? null/);
});

test('INV-2A finalization is open only; no ribbon/warnings', () => {
  assert.match(serviceSource, /state_key: 'open'/);
  assert.doesNotMatch(serviceSource, /ribbon_stages/);
  assert.doesNotMatch(serviceSource, /warnings:/);
  assert.equal(INVOICE_LIFECYCLE_AGGREGATE_KEY, 'invoice_lifecycle_aggregate');
});

test('INV-2A route is single Income aggregate endpoint', () => {
  assert.match(routesSource, /\/aggregates\/invoice-lifecycle/);
  assert.match(routesSource, /buildInvoiceLifecycleAggregate/);
  assert.doesNotMatch(routesSource, /invoice-lifecycle.*payment-case/);
});

test('INV-2A no duplicate lifecycle columns on income_documents migration', () => {
  assert.doesNotMatch(migration122, /\bpayment_status\b/);
  assert.doesNotMatch(migration122, /\bdelivery_status\b/);
  assert.doesNotMatch(migration122, /\boverdue\b/);
  assert.doesNotMatch(migration122, /\blifecycle_status\b/);
  assert.doesNotMatch(serviceSource, /payment_status/);
  assert.doesNotMatch(serviceSource, /delivery_status/);
  assert.doesNotMatch(pureSource, /alter table.*income_documents/i);
});

test('INV-2A collectible types reuse Income catalog helper', () => {
  assert.match(pureSource, /isInvoiceCollectionDocumentType/);
  const quoteDue = composeInvoiceLifecycleDueDimension({
    documentStatus: 'issued',
    documentType: 'quote',
    dueDate: '2026-01-01',
    remainingBalance: 10,
    paymentStateKey: 'unpaid',
    todayIso: TODAY,
  });
  assert.equal(quoteDue.state_key, 'not_applicable');
});

test('INV-2A parallel independent reads in composer', () => {
  assert.match(serviceSource, /Promise\.all/);
  assert.match(serviceSource, /listAttempts/);
  assert.match(serviceSource, /loadActiveCollectionWorkItem/);
});
