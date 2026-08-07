/**
 * INV-4 closeout — send (4D) + auto-close/reopen (4E) + ICC contract tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCollectionReminderSendIdempotencyKey,
  COLLECTION_REMINDER_DELIVERY_ENTITY_TYPE,
  COLLECTION_REMINDER_DELIVERY_SOURCE_MODULE,
  COLLECTION_REMINDER_SEND_COMMAND,
  composeCollectionReminderSendMessage,
  INCOME_WORK_EVENT_INVOICE_PAID,
  INVOICE_COLLECTION_CONTROL_AGGREGATE_KEY,
  isIncomeInvoicePaidFactEventType,
  resolveCollectionReminderSendGate,
  resolveInvoiceCollectionControlStatus,
  shouldAutoCloseCollectionFollowup,
  INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE,
} from '../../src/domains/work-engine/work-engine-collection-reminder.pure.js';
import { resolveIncomeOverdueCollectionIntake } from '../../src/domains/income/invoice-lifecycle.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const sendSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-collection-reminder-send.service.ts'),
  'utf8',
);
const paidSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-collection-paid-fact.service.ts'),
  'utf8',
);
const intakeSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.event-intake.service.ts'),
  'utf8',
);
const reversalSource = readFileSync(
  join(dir, '../../src/domains/accounting-base/accounting-base-income-payment-reversal.service.ts'),
  'utf8',
);
const bridgeSource = readFileSync(
  join(dir, '../../src/domains/income/income-work-engine-bridge.ts'),
  'utf8',
);
const reviewSource = readFileSync(
  join(
    dir,
    '../../src/domains/work-engine/work-engine-collection-reminder-review.read-model.service.ts',
  ),
  'utf8',
);
const iccSource = readFileSync(
  join(
    dir,
    '../../src/domains/work-engine/work-engine-invoice-collection-control.read-model.service.ts',
  ),
  'utf8',
);
const commandsSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.commands.service.ts'),
  'utf8',
);
const routesSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.routes.ts'),
  'utf8',
);

const TODAY = '2026-08-07';

test('INV-4 A: approved → send path uses Delivery begin/finalize', () => {
  assert.equal(COLLECTION_REMINDER_SEND_COMMAND, 'send_collection_reminder');
  assert.match(sendSource, /beginAttempt/);
  assert.match(sendSource, /finalizeAttempt/);
  assert.match(sendSource, /createSystemMessageCore/);
  assert.match(sendSource, /sendEmail/);
  assert.match(commandsSource, /case 'send_collection_reminder'/);
  assert.match(routesSource, /send_collection_reminder/);
});

test('INV-4 B: delivery failure marks delivery_failed', () => {
  assert.match(sendSource, /status: 'delivery_failed'/);
  assert.match(sendSource, /result: 'failed'/);
  const gate = resolveCollectionReminderSendGate({
    workType: INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE,
    candidateStatus: 'delivery_failed',
    stillOpenOverdue: true,
    paymentStateKey: 'unpaid',
    remainingBalance: 1000,
    messageBody: 'body',
    canWrite: true,
    hasDeliveryChannel: true,
    hasRecipient: true,
  });
  assert.equal(gate.allowed, true);
});

test('INV-4 C: retry uses new idempotency ordinal + delivery_failed sendable', () => {
  const k1 = buildCollectionReminderSendIdempotencyKey({
    candidateId: 'c1',
    attemptOrdinal: 1,
  });
  const k2 = buildCollectionReminderSendIdempotencyKey({
    candidateId: 'c1',
    attemptOrdinal: 2,
  });
  assert.notEqual(k1, k2);
  assert.match(sendSource, /attemptOrdinal/);
  assert.match(reviewSource, /נסה שוב/);
});

test('INV-4 D: paid before send → reject', () => {
  const intake = resolveIncomeOverdueCollectionIntake({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: '2026-07-01',
    originalAmount: 1000,
    paidAmount: 1000,
    todayIso: TODAY,
  });
  const gate = resolveCollectionReminderSendGate({
    workType: INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE,
    candidateStatus: 'approved',
    stillOpenOverdue: intake.eligible,
    paymentStateKey: intake.payment_state_key,
    remainingBalance: intake.remaining_balance,
    messageBody: 'body',
    canWrite: true,
    hasDeliveryChannel: true,
    hasRecipient: true,
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason_key, 'invoice_paid');
  assert.match(sendSource, /resolveCollectionReminderSendGate/);
});

test('INV-4 E: partial before send → current remaining in message', () => {
  const msg = composeCollectionReminderSendMessage({
    subject: 'תזכורת',
    body: 'שלום, נא לשלם',
    documentNumber: '1001',
    remainingBalance: 600,
    currency: 'ILS',
    daysOverdue: 37,
    paymentStateKey: 'partial',
  });
  assert.match(msg.body, /יתרה לתשלום: 600 ILS/);
  assert.match(msg.body, /מצב תשלום: partial/);
  const again = composeCollectionReminderSendMessage({
    subject: msg.subject,
    body: msg.body,
    documentNumber: '1001',
    remainingBalance: 200,
    currency: 'ILS',
    daysOverdue: 40,
    paymentStateKey: 'partial',
  });
  assert.match(again.body, /יתרה לתשלום: 200 ILS/);
  assert.doesNotMatch(again.body, /יתרה לתשלום: 600 ILS/);
});

test('INV-4 F: payment after send → auto close when paid', () => {
  assert.equal(
    shouldAutoCloseCollectionFollowup({ paymentStateKey: 'paid', remainingBalance: 0 }),
    true,
  );
  assert.match(paidSource, /collection_followup_auto_closed_paid/);
  assert.match(paidSource, /work_state: 'done'/);
  assert.match(intakeSource, /consumeIncomeInvoicePaidFact/);
  assert.equal(isIncomeInvoicePaidFactEventType(INCOME_WORK_EVENT_INVOICE_PAID), true);
});

test('INV-4 G: partial payment → stay open', () => {
  assert.equal(
    shouldAutoCloseCollectionFollowup({ paymentStateKey: 'partial', remainingBalance: 400 }),
    false,
  );
  assert.match(paidSource, /income_invoice_partial_fact_acknowledged/);
});

test('INV-4 H: allocation reversal → reopen via income.invoice_overdue', () => {
  assert.match(reversalSource, /emitIncomeInvoiceOverdueAfterPaymentReversal/);
  assert.match(bridgeSource, /emitIncomeInvoiceOverdueAfterPaymentReversal/);
  assert.match(bridgeSource, /emitOverdueIntakeIfEligible/);
});

test('INV-4 I: Test3/Test4 isolation — org scoping on send/paid/ICC', () => {
  assert.match(sendSource, /\.eq\('org_id', params\.orgId\)/);
  assert.match(sendSource, /\.eq\('organization_id', params\.orgId\)/);
  assert.match(paidSource, /\.eq\('org_id', params\.orgId\)/);
  assert.match(iccSource, /\.eq\('organization_id', params\.orgId\)/);
});

test('INV-4 J: duplicate send prevention / already_sent', () => {
  const gate = resolveCollectionReminderSendGate({
    workType: INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE,
    candidateStatus: 'sent',
    stillOpenOverdue: true,
    paymentStateKey: 'unpaid',
    remainingBalance: 1000,
    messageBody: 'body',
    canWrite: true,
    hasDeliveryChannel: true,
    hasRecipient: true,
  });
  assert.equal(gate.reason_key, 'already_sent');
  assert.match(sendSource, /idempotentReplay: true/);
  assert.match(sendSource, /status === 'sent'/);
});

test('INV-4 K: command replay via executeWithCommandIdempotency', () => {
  assert.match(commandsSource, /executeWithCommandIdempotency/);
  assert.match(commandsSource, /case 'send_collection_reminder'/);
  assert.match(commandsSource, /refresh_aggregate/);
});

test('INV-4 L: history from delivery_attempts + no FE logic', () => {
  assert.equal(
    COLLECTION_REMINDER_DELIVERY_SOURCE_MODULE,
    'work_engine',
  );
  assert.equal(COLLECTION_REMINDER_DELIVERY_ENTITY_TYPE, 'work_reminder_candidate');
  assert.match(reviewSource, /listAttempts/);
  assert.match(reviewSource, /attempt_count/);
  assert.match(iccSource, /delivery_attempts/);
  assert.doesNotMatch(commandsSource, /payload\.remaining_balance/);
});

test('INV-4 ICC backend contract statuses', () => {
  assert.equal(INVOICE_COLLECTION_CONTROL_AGGREGATE_KEY, 'invoice_collection_control_aggregate');
  assert.equal(
    resolveInvoiceCollectionControlStatus({
      collectionActive: true,
      collectionWorkState: 'waiting_client',
      paymentStateKey: 'unpaid',
      remainingBalance: 1000,
      latestCandidateStatus: 'pending_review',
    }),
    'waiting_review',
  );
  assert.equal(
    resolveInvoiceCollectionControlStatus({
      collectionActive: true,
      collectionWorkState: 'waiting_client',
      paymentStateKey: 'unpaid',
      remainingBalance: 1000,
      latestCandidateStatus: 'approved',
    }),
    'approved',
  );
  assert.equal(
    resolveInvoiceCollectionControlStatus({
      collectionActive: true,
      collectionWorkState: 'waiting_client',
      paymentStateKey: 'unpaid',
      remainingBalance: 1000,
      latestCandidateStatus: 'sent',
    }),
    'waiting_payment',
  );
  assert.equal(
    resolveInvoiceCollectionControlStatus({
      collectionActive: false,
      collectionWorkState: 'done',
      paymentStateKey: 'paid',
      remainingBalance: 0,
      latestCandidateStatus: 'sent',
    }),
    'collection_closed',
  );
  assert.match(routesSource, /aggregates\/invoice-collection-control/);
  assert.match(iccSource, /promise_tracking/);
  assert.match(iccSource, /supported: false/);
});

test('INV-4 no second delivery engine', () => {
  assert.match(sendSource, /from '\.\.\/delivery\/index\.js'/);
  assert.doesNotMatch(sendSource, /create table|collection_delivery_attempts/);
});
