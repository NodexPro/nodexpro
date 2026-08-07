/**
 * INV-4C — collection reminder accountant review / approval tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLLECTION_REMINDER_APPROVE_COMMAND,
  COLLECTION_REMINDER_REVIEW_AGGREGATE_KEY,
  INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE,
  isCollectionReminderMutatableStatus,
  resolveCollectionReminderApproveGate,
} from '../../src/domains/work-engine/work-engine-collection-reminder.pure.js';
import { resolveIncomeOverdueCollectionIntake } from '../../src/domains/income/invoice-lifecycle.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const reviewAggSource = readFileSync(
  join(
    dir,
    '../../src/domains/work-engine/work-engine-collection-reminder-review.read-model.service.ts',
  ),
  'utf8',
);
const reminderReviewSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.reminder-review.service.ts'),
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
const typesSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.types.ts'),
  'utf8',
);

const TODAY = '2026-08-07';

function unpaidOverdue() {
  return resolveIncomeOverdueCollectionIntake({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: '2026-07-01',
    originalAmount: 1000,
    paidAmount: 0,
    todayIso: TODAY,
  });
}

function partialOverdue() {
  return resolveIncomeOverdueCollectionIntake({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: '2026-07-01',
    originalAmount: 1000,
    paidAmount: 400,
    todayIso: TODAY,
  });
}

function paidPastDue() {
  return resolveIncomeOverdueCollectionIntake({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: '2026-07-01',
    originalAmount: 1000,
    paidAmount: 1000,
    todayIso: TODAY,
  });
}

test('INV-4C A: pending collection candidate review uses current AB/overdue truth', () => {
  const intake = unpaidOverdue();
  assert.equal(intake.eligible, true);
  assert.equal(intake.remaining_balance, 1000);
  assert.match(reviewAggSource, /sumPostedAllocationsForIncomeDocuments/);
  assert.match(reviewAggSource, /resolveIncomeOverdueCollectionIntake/);
  assert.match(reviewAggSource, /financial_source: 'accounting_base'/);
  assert.equal(COLLECTION_REMINDER_REVIEW_AGGREGATE_KEY, 'collection_reminder_review_aggregate');
});

test('INV-4C B: partial payment after candidate creation → remaining/partial gate', () => {
  const intake = partialOverdue();
  assert.equal(intake.payment_state_key, 'partial');
  assert.equal(intake.remaining_balance, 600);
  const gate = resolveCollectionReminderApproveGate({
    workType: INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE,
    candidateStatus: 'pending_review',
    stillOpenOverdue: intake.eligible,
    paymentStateKey: intake.payment_state_key,
    remainingBalance: intake.remaining_balance,
    messageBody: 'נא לשלם את היתרה',
    canWrite: true,
    hasDeliveryChannel: true,
  });
  assert.equal(gate.allowed, true);
  assert.equal(gate.reason_key, null);
});

test('INV-4C C: invoice fully paid before review → approve disabled', () => {
  const intake = paidPastDue();
  const gate = resolveCollectionReminderApproveGate({
    workType: INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE,
    candidateStatus: 'pending_review',
    stillOpenOverdue: intake.eligible,
    paymentStateKey: intake.payment_state_key,
    remainingBalance: intake.remaining_balance,
    messageBody: 'body',
    canWrite: true,
    hasDeliveryChannel: true,
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason_key, 'invoice_paid');
  assert.match(reviewAggSource, /assertCollectionReminderApprovable/);
});

test('INV-4C D: edit subject/body only — financial fields not writable', () => {
  assert.match(reminderReviewSource, /status: 'edited'/);
  assert.match(reviewAggSource, /editable_fields: \['subject', 'body'\]/);
  assert.match(reviewAggSource, /editable_fields: Array<'subject' \| 'body'>/);
  assert.match(commandsSource, /case 'edit_reminder_candidate'/);
  assert.doesNotMatch(commandsSource, /payload\.remaining_balance|payload\.paid_amount/);
});

test('INV-4C E: approve valid candidate → approved, no delivery', () => {
  assert.match(reminderReviewSource, /export async function approveReminderCandidate/);
  assert.match(reminderReviewSource, /ready_for_delivery: true/);
  assert.match(reminderReviewSource, /sent: false/);
  assert.match(reminderReviewSource, /delivery_status: 'not_started'/);
  assert.doesNotMatch(
    reminderReviewSource.slice(
      reminderReviewSource.indexOf('export async function approveReminderCandidate'),
      reminderReviewSource.indexOf('export async function approveSendReminderCandidate'),
    ),
    /createSystemMessageCore|ensureReminderDeliveryIntent/,
  );
  assert.equal(COLLECTION_REMINDER_APPROVE_COMMAND, 'approve_reminder_candidate');
});

test('INV-4C F: approve twice → idempotent alreadyApproved', () => {
  assert.match(reminderReviewSource, /alreadyApproved: true/);
  assert.match(reminderReviewSource, /if \(current\.status === 'approved'\)/);
  const gate = resolveCollectionReminderApproveGate({
    workType: INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE,
    candidateStatus: 'approved',
    stillOpenOverdue: true,
    paymentStateKey: 'unpaid',
    remainingBalance: 1000,
    messageBody: 'body',
    canWrite: true,
    hasDeliveryChannel: true,
  });
  assert.equal(gate.allowed, true);
});

test('INV-4C G: cancel → cancelled; cannot approve afterward', () => {
  assert.match(reminderReviewSource, /status: 'cancelled'/);
  const gate = resolveCollectionReminderApproveGate({
    workType: INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE,
    candidateStatus: 'cancelled',
    stillOpenOverdue: true,
    paymentStateKey: 'unpaid',
    remainingBalance: 1000,
    messageBody: 'body',
    canWrite: true,
    hasDeliveryChannel: true,
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason_key, 'candidate_terminal');
  assert.equal(isCollectionReminderMutatableStatus('cancelled'), false);
});

test('INV-4C H/I: cross-client / cross-org rejected', () => {
  assert.match(reviewAggSource, /Collection candidate client mismatch/);
  assert.match(reviewAggSource, /\.eq\('organization_id', params\.orgId\)/);
  assert.match(reviewAggSource, /\.eq\('org_id', params\.orgId\)/);
  assert.match(reminderReviewSource, /\.eq\('org_id', orgId\)/);
});

test('INV-4C J: non-collection work item rejected for collection review', () => {
  const gate = resolveCollectionReminderApproveGate({
    workType: 'payroll_document_collection',
    candidateStatus: 'pending_review',
    stillOpenOverdue: true,
    paymentStateKey: 'unpaid',
    remainingBalance: 1000,
    messageBody: 'body',
    canWrite: true,
    hasDeliveryChannel: true,
  });
  assert.equal(gate.reason_key, 'not_collection_work_item');
  assert.match(reviewAggSource, /not_collection_reminder_candidate/);
  assert.match(reviewAggSource, /INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE/);
});

test('INV-4C K: no FE financial truth accepted on edit/approve', () => {
  assert.match(commandsSource, /reqString\(payload, 'body'\)/);
  assert.doesNotMatch(commandsSource, /payload\.original_amount|payload\.days_overdue/);
  assert.match(reviewAggSource, /financial_source: 'accounting_base'/);
});

test('INV-4C L: allowed_actions match state (approve/edit/cancel/snooze)', () => {
  assert.match(reviewAggSource, /label: 'אישור'/);
  assert.match(reviewAggSource, /label: 'עריכה'/);
  assert.match(reviewAggSource, /label: 'ביטול'/);
  assert.match(reviewAggSource, /label: 'דחייה'/);
  assert.match(reviewAggSource, /COLLECTION_REMINDER_APPROVE_COMMAND/);
  assert.match(reviewAggSource, /approve_does_not_send: true/);
});

test('INV-4C M: command response returns refreshed collection review case', () => {
  assert.match(commandsSource, /REFRESH_COLLECTION_REVIEW/);
  assert.match(commandsSource, /buildCollectionReminderReviewAggregate/);
  assert.match(commandsSource, /resolveReminderCommandRefreshPayload/);
  assert.match(typesSource, /collection_reminder_review_aggregate/);
  assert.match(routesSource, /aggregates\/collection-reminder-review/);
});

test('INV-4C N: no send triggered on collection approve path', () => {
  assert.match(reminderReviewSource, /collection_approve_does_not_send/);
  assert.match(reviewAggSource, /approve_does_not_send: true/);
  assert.match(commandsSource, /case 'approve_reminder_candidate'/);
  assert.match(routesSource, /approve_reminder_candidate/);
});

test('INV-4C snooze reuses generic workflow', () => {
  assert.match(reviewAggSource, /snooze_reminder_candidate/);
  assert.match(reminderReviewSource, /export async function snoozeReminderCandidate/);
});

test('INV-4C Hebrew UI contract: בדיקת תזכורת גבייה; Approve != Send', () => {
  assert.match(reviewAggSource, /בדיקת תזכורת גבייה/);
  assert.match(reviewAggSource, /approve_means_ready_for_delivery: true/);
  assert.doesNotMatch(reviewAggSource, /אישור ושליחה/);
});
