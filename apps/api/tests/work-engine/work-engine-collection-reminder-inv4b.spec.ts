/**
 * INV-4B — collection SLA / reminder candidate tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLLECTION_REMINDER_SCAN_MAX_PAGES,
  COLLECTION_REMINDER_SCAN_PAGE_SIZE,
  COLLECTION_WAITING_CLIENT_TIMEOUT_DEFAULT_MINUTES,
  composeCollectionReminderInvoiceTruth,
  INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE,
  shouldCreateCollectionReminderCandidate,
} from '../../src/domains/work-engine/work-engine-collection-reminder.pure.js';
import {
  ACTIVE_REMINDER_CANDIDATE_STATUSES,
  TERMINAL_REMINDER_CANDIDATE_STATUSES,
  buildReminderCandidateDedupKey,
  isCadenceStepEligible,
  listEligibleCadenceSteps,
  shouldEvaluateReminderWorkflow,
  type ReminderObligationSnapshot,
} from '../../src/domains/work-engine/work-engine.reminder.logic.js';
import { resolveIncomeOverdueCollectionIntake } from '../../src/domains/income/invoice-lifecycle.pure.js';
import { assertValidOperationalReminderPolicyPayload } from '../../src/domains/country-pack/operational-communication-owner-payload.js';

const dir = dirname(fileURLToPath(import.meta.url));
const schedulerSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.scheduler.service.ts'),
  'utf8',
);
const collectionScanSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-collection-reminder.scheduler.service.ts'),
  'utf8',
);
const reminderServiceSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.reminder.service.ts'),
  'utf8',
);
const reminderLogicSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.reminder.logic.ts'),
  'utf8',
);
const slaSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.sla.service.ts'),
  'utf8',
);
const intakeSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.event-intake.service.ts'),
  'utf8',
);
const reviewSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.reminder-review.service.ts'),
  'utf8',
);
const policySource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.policy.service.ts'),
  'utf8',
);

const TODAY = '2026-08-07';

test('INV-4B A: overdue unpaid collection item + reminder due → candidate allowed', () => {
  const intake = resolveIncomeOverdueCollectionIntake({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: '2026-07-01',
    originalAmount: 1000,
    paidAmount: 0,
    todayIso: TODAY,
  });
  assert.equal(intake.eligible, true);
  assert.equal(
    shouldCreateCollectionReminderCandidate({
      workType: INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE,
      workState: 'waiting_client',
      stillOpenOverdue: intake.eligible,
    }),
    true,
  );

  const policy = assertValidOperationalReminderPolicyPayload({
    type: 'operational_reminder_policy',
    default_channels: ['email'],
    workflows: [
      {
        workflow_type: 'waiting_client',
        enabled: true,
        anchor: 'obligation_starts_at',
        cadence_steps: [
          {
            step_key: 'nudge_waiting_client_7d',
            offset_minutes: 0,
            template_key: 'comm.reminder.template.waiting_client.7d.he',
            channels: ['email'],
          },
        ],
      },
    ],
  });
  const obligation: ReminderObligationSnapshot = {
    kind: 'waiting_client',
    starts_at: '2026-08-01T00:00:00.000Z',
    due_at: '2026-08-08T00:00:00.000Z',
    status: 'active',
    paused_at: null,
  };
  const wf = policy.workflows[0]!;
  const dueNow = listEligibleCadenceSteps({
    workflow: wf,
    obligation,
    nowMs: new Date('2026-08-07T12:00:00.000Z').getTime(),
  });
  assert.equal(dueNow.length, 1);
  assert.equal(dueNow[0]!.step_key, 'nudge_waiting_client_7d');
});

test('INV-4B B: same evaluator twice → one candidate (dedup key + active reuse)', () => {
  const key = buildReminderCandidateDedupKey({
    workItemId: '11111111-1111-4111-8111-111111111111',
    workflowType: 'waiting_client',
    stepKey: 'nudge_waiting_client_7d',
  });
  assert.equal(
    key,
    'reminder:11111111-1111-4111-8111-111111111111:waiting_client:nudge_waiting_client_7d',
  );
  assert.match(reminderServiceSource, /findActiveCandidateByTuple/);
  assert.match(reminderServiceSource, /dedupHit: true/);
  assert.match(reminderServiceSource, /code === '23505'/);
  assert.ok(ACTIVE_REMINDER_CANDIDATE_STATUSES.includes('pending_review'));
});

test('INV-4B C: partial overdue → remaining balance / payment_state partial in truth', () => {
  const intake = resolveIncomeOverdueCollectionIntake({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: '2026-07-01',
    originalAmount: 1000,
    paidAmount: 400,
    todayIso: TODAY,
  });
  assert.equal(intake.eligible, true);
  assert.equal(intake.payment_state_key, 'partial');
  assert.equal(intake.remaining_balance, 600);
  const truth = composeCollectionReminderInvoiceTruth({
    incomeDocumentId: 'doc-1',
    documentNumber: '1001',
    documentDate: '2026-06-01',
    dueDate: '2026-07-01',
    daysOverdue: intake.days_overdue,
    currency: 'ILS',
    originalAmount: 1000,
    paidAmount: 400,
    remainingBalance: intake.remaining_balance,
    paymentStateKey: intake.payment_state_key,
    clientId: 'client-1',
  });
  assert.equal(truth.remaining_balance, 600);
  assert.equal(truth.payment_state_key, 'partial');
  assert.equal(truth.paid_amount, 400);
  assert.match(reviewSource, /remaining_balance/);
  assert.match(reviewSource, /collection_invoice_truth/);
});

test('INV-4B D: paid invoice with stale collection item → no new candidate', () => {
  const intake = resolveIncomeOverdueCollectionIntake({
    documentStatus: 'issued',
    documentType: 'tax_invoice',
    dueDate: '2026-07-01',
    originalAmount: 1000,
    paidAmount: 1000,
    todayIso: TODAY,
  });
  assert.equal(intake.eligible, false);
  assert.equal(
    shouldCreateCollectionReminderCandidate({
      workType: INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE,
      workState: 'waiting_client',
      stillOpenOverdue: intake.eligible,
    }),
    false,
  );
  assert.match(collectionScanSource, /skipped_resolved_debt/);
  assert.doesNotMatch(collectionScanSource, /work_state.*=.*['"]done['"]/);
});

test('INV-4B E: future SLA cadence → no candidate', () => {
  const policy = assertValidOperationalReminderPolicyPayload({
    type: 'operational_reminder_policy',
    default_channels: ['email'],
    workflows: [
      {
        workflow_type: 'waiting_client',
        enabled: true,
        anchor: 'obligation_starts_at',
        cadence_steps: [
          {
            step_key: 'nudge_waiting_client_7d',
            offset_minutes: 10080,
            template_key: 'comm.reminder.template.waiting_client.7d.he',
          },
        ],
      },
    ],
  });
  const obligation: ReminderObligationSnapshot = {
    kind: 'waiting_client',
    starts_at: '2026-08-07T00:00:00.000Z',
    due_at: '2026-08-14T00:00:00.000Z',
    status: 'active',
    paused_at: null,
  };
  const nowMs = new Date('2026-08-07T01:00:00.000Z').getTime();
  assert.equal(
    isCadenceStepEligible(nowMs, obligation.starts_at, 10080),
    false,
  );
  assert.equal(
    listEligibleCadenceSteps({
      workflow: policy.workflows[0]!,
      obligation,
      nowMs,
    }).length,
    0,
  );
});

test('INV-4B F: existing pending candidate → no duplicate (active statuses)', () => {
  assert.ok(ACTIVE_REMINDER_CANDIDATE_STATUSES.includes('pending_review'));
  assert.ok(ACTIVE_REMINDER_CANDIDATE_STATUSES.includes('edited'));
  assert.ok(ACTIVE_REMINDER_CANDIDATE_STATUSES.includes('snoozed'));
  assert.match(reminderServiceSource, /findActiveCandidateByTuple/);
  assert.match(reminderServiceSource, /ACTIVE_REMINDER_CANDIDATE_STATUSES/);
});

test('INV-4B G: previous sent reminder + next stage not due → no next candidate', () => {
  assert.ok(TERMINAL_REMINDER_CANDIDATE_STATUSES.includes('sent'));
  assert.match(reminderServiceSource, /terminalCount > 0 && !manualTest/);
  const policy = assertValidOperationalReminderPolicyPayload({
    type: 'operational_reminder_policy',
    default_channels: ['email'],
    workflows: [
      {
        workflow_type: 'waiting_client',
        enabled: true,
        anchor: 'obligation_starts_at',
        cadence_steps: [
          {
            step_key: 'nudge_1',
            offset_minutes: 0,
            template_key: 'comm.reminder.template.waiting_client.1h.he',
          },
          {
            step_key: 'nudge_2',
            offset_minutes: 10080,
            template_key: 'comm.reminder.template.waiting_client.7d.he',
          },
        ],
      },
    ],
  });
  const obligation: ReminderObligationSnapshot = {
    kind: 'waiting_client',
    starts_at: '2026-08-07T00:00:00.000Z',
    due_at: '2026-08-14T00:00:00.000Z',
    status: 'active',
    paused_at: null,
  };
  const nowMs = new Date('2026-08-07T12:00:00.000Z').getTime();
  const steps = listEligibleCadenceSteps({
    workflow: policy.workflows[0]!,
    obligation,
    nowMs,
  });
  assert.deepEqual(
    steps.map((s) => s.step_key),
    ['nudge_1'],
  );
});

test('INV-4B H: next stage due → next cadence step eligible (sequence)', () => {
  const policy = assertValidOperationalReminderPolicyPayload({
    type: 'operational_reminder_policy',
    default_channels: ['email'],
    workflows: [
      {
        workflow_type: 'waiting_client',
        enabled: true,
        anchor: 'obligation_starts_at',
        cadence_steps: [
          {
            step_key: 'nudge_1',
            offset_minutes: 0,
            template_key: 'comm.reminder.template.waiting_client.1h.he',
          },
          {
            step_key: 'nudge_2',
            offset_minutes: 1440,
            template_key: 'comm.reminder.template.waiting_client.7d.he',
          },
        ],
      },
    ],
  });
  const obligation: ReminderObligationSnapshot = {
    kind: 'waiting_client',
    starts_at: '2026-08-01T00:00:00.000Z',
    due_at: '2026-08-08T00:00:00.000Z',
    status: 'active',
    paused_at: null,
  };
  const steps = listEligibleCadenceSteps({
    workflow: policy.workflows[0]!,
    obligation,
    nowMs: new Date('2026-08-03T00:00:00.000Z').getTime(),
  });
  assert.deepEqual(
    steps.map((s) => s.step_key),
    ['nudge_1', 'nudge_2'],
  );
});

test('INV-4B I/J: insert fail / crash before response → retryable + race reuse', () => {
  assert.match(reminderServiceSource, /code === '23505'/);
  assert.match(reminderServiceSource, /racedActive/);
  assert.match(collectionScanSource, /summary\.errors \+= 1/);
  assert.doesNotMatch(collectionScanSource, /processed_collection_reminder/);
});

test('INV-4B K: Test3/Test4 isolation — org + client scoping on scan/review', () => {
  assert.match(collectionScanSource, /\.eq\('org_id', params\.orgId\)/);
  assert.match(collectionScanSource, /item\.client_id !== doc\.represented_client_id/);
  assert.match(reviewSource, /\.eq\('organization_id', params\.orgId\)/);
  assert.match(collectionScanSource, /INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE/);
});

test('INV-4B L: missed scheduler → catch-up pages + cadence eligibility by nowMs', () => {
  assert.equal(COLLECTION_REMINDER_SCAN_PAGE_SIZE, 200);
  assert.equal(COLLECTION_REMINDER_SCAN_MAX_PAGES, 25);
  assert.match(collectionScanSource, /COLLECTION_REMINDER_SCAN_MAX_PAGES/);
  assert.match(schedulerSource, /scanCollectionReminderCandidatesForOrg/);
  assert.match(reminderLogicSource, /nowMs >= computeCadenceTriggerAtMs/);
});

test('INV-4B M: no N× payment-case reads — batch AB + collectionDebtPrechecked gate', () => {
  assert.match(collectionScanSource, /sumPostedAllocationsForIncomeDocuments/);
  assert.match(reminderServiceSource, /collectionDebtPrechecked/);
  assert.match(
    reminderServiceSource,
    /INVOICE_COLLECTION_FOLLOWUP_WORK_TYPE[\s\S]*collectionDebtPrechecked !== true/,
  );
  assert.match(collectionScanSource, /collectionDebtPrechecked: true/);
  assert.doesNotMatch(collectionScanSource, /loadIncomeInvoicePaymentCase|payment_case/);
});

test('INV-4B N: no message sent in INV-4B path', () => {
  assert.match(reminderServiceSource, /never sends or inserts work_notifications/);
  assert.match(collectionScanSource, /never sends, approves, or closes/);
  assert.doesNotMatch(collectionScanSource, /approve_send_reminder|createSystemMessage|sendEmail/);
  assert.match(reminderServiceSource, /status: 'pending_review'/);
});

test('INV-4B policy ownership + SLA start on waiting_client intake', () => {
  assert.equal(COLLECTION_WAITING_CLIENT_TIMEOUT_DEFAULT_MINUTES, 10080);
  assert.match(policySource, /waiting_client_timeout_minutes: 10080/);
  assert.match(slaSource, /startWaitingClientObligationIfAbsent/);
  assert.match(intakeSource, /startWaitingClientObligationIfAbsent/);
  assert.match(intakeSource, /mappedInitialState === 'waiting_client'/);
  assert.match(collectionScanSource, /resolveIncomeOverdueCollectionIntake/);
  assert.equal(
    shouldEvaluateReminderWorkflow({
      workflowType: 'waiting_client',
      workState: 'waiting_client',
      obligations: [],
    }),
    true,
  );
});

test('INV-4B rejected/cancelled/sent reuse existing terminal infrastructure', () => {
  assert.ok(TERMINAL_REMINDER_CANDIDATE_STATUSES.includes('cancelled'));
  assert.ok(TERMINAL_REMINDER_CANDIDATE_STATUSES.includes('sent'));
  assert.ok(TERMINAL_REMINDER_CANDIDATE_STATUSES.includes('delivery_failed'));
  assert.doesNotMatch(reminderLogicSource, /'rejected'/);
  assert.match(reviewSource, /cancel_reminder_candidate/);
});
