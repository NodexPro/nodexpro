import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveEventMapping } from '../../src/domains/work-engine/work-engine.event-mapping.service.js';
import {
  isRecurringSendFollowupDue,
  matchesRecurringInvoiceReviewWorkItem,
} from '../../src/domains/work-engine/work-engine-invoice-retainer-lifecycle.pure.js';
import { recurringProfileWorkPeriodKey } from '../../src/domains/work-engine/work-engine-invoice-retainer.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const lifecycleSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-lifecycle.service.ts'),
  'utf8',
);
const commandsSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer.commands.service.ts'),
  'utf8',
);
const typesSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer.types.ts'),
  'utf8',
);
const schedulerSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.scheduler.service.ts'),
  'utf8',
);
const sendFollowupSchedulerSource = readFileSync(
  join(
    dir,
    '../../src/domains/work-engine/work-engine-invoice-retainer-send-followup.scheduler.service.ts',
  ),
  'utf8',
);
const bridgeSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-bridge.ts'),
  'utf8',
);
const deliverySource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-delivery.read.ts'),
  'utf8',
);

const profileId = '11111111-1111-4111-8111-111111111111';
const otherProfileId = '22222222-2222-4222-8222-222222222222';
const cycleDateA = '2026-06-20';
const cycleDateB = '2026-06-23';
const periodKeyA = recurringProfileWorkPeriodKey(profileId, cycleDateA);
const periodKeyB = recurringProfileWorkPeriodKey(profileId, cycleDateB);

test('recurring_document_draft_created maps to recurring_invoice_review / waiting_human', () => {
  const mapped = resolveEventMapping({
    event_type: 'recurring_document_draft_created',
    period_key: periodKeyA,
  });
  assert.equal(mapped.resolved, true);
  if (!mapped.resolved) return;
  assert.equal(mapped.work_type, 'recurring_invoice_review');
  assert.equal(mapped.initial_state, 'waiting_human');
});

test('recurring_document_send_followup_due maps to recurring_document_send_followup', () => {
  const mapped = resolveEventMapping({
    event_type: 'recurring_document_send_followup_due',
    period_key: periodKeyA,
  });
  assert.equal(mapped.resolved, true);
  if (!mapped.resolved) return;
  assert.equal(mapped.work_type, 'recurring_document_send_followup');
  assert.equal(mapped.initial_state, 'waiting_human');
});

test('recurring_document_approved is audit-only (no work_item mapping)', () => {
  const mapped = resolveEventMapping({
    event_type: 'recurring_document_approved',
    period_key: periodKeyA,
  });
  assert.equal(mapped.resolved, false);
});

test('approve_recurring_document_draft command completes review work_item via lifecycle service', () => {
  assert.match(typesSource, /approveDraft:\s*'approve_recurring_document_draft'/);
  assert.match(commandsSource, /WORK_ENGINE_INVOICE_RETAINER_COMMANDS\.approveDraft/);
  assert.match(commandsSource, /approveRecurringDocumentDraft/);
  assert.match(lifecycleSource, /completeRecurringInvoiceReviewWorkItem/);
  assert.match(lifecycleSource, /work_state:\s*'done'/);
  assert.doesNotMatch(lifecycleSource, /\.delete\(/);
});

test('same retainer different cycle period_key does not match wrong review work_item', () => {
  const itemA = {
    module_key: 'income',
    work_type: 'recurring_invoice_review',
    source_entity_id: profileId,
    period_key: periodKeyA,
    work_state: 'waiting_human',
  };
  const itemB = {
    module_key: 'income',
    work_type: 'recurring_invoice_review',
    source_entity_id: profileId,
    period_key: periodKeyB,
    work_state: 'waiting_human',
  };
  assert.equal(
    matchesRecurringInvoiceReviewWorkItem(itemA, {
      recurringProfileId: profileId,
      periodKey: periodKeyA,
    }),
    true,
  );
  assert.equal(
    matchesRecurringInvoiceReviewWorkItem(itemB, {
      recurringProfileId: profileId,
      periodKey: periodKeyA,
    }),
    false,
  );
  assert.equal(
    matchesRecurringInvoiceReviewWorkItem(itemA, {
      recurringProfileId: otherProfileId,
      periodKey: periodKeyA,
    }),
    false,
  );
});

test('after 2 days without delivery send-followup becomes due', () => {
  const approvedAt = '2026-06-01T10:00:00.000Z';
  const beforeDue = '2026-06-02T23:59:59.999Z';
  const afterDue = '2026-06-03T10:00:00.000Z';
  assert.equal(
    isRecurringSendFollowupDue({
      approvedAtIso: approvedAt,
      nowIso: beforeDue,
      hasDeliveryRecord: false,
    }),
    false,
  );
  assert.equal(
    isRecurringSendFollowupDue({
      approvedAtIso: approvedAt,
      nowIso: afterDue,
      hasDeliveryRecord: false,
    }),
    true,
  );
});

test('if delivery exists no send-followup work_item is created by scheduler scan', () => {
  assert.match(sendFollowupSchedulerSource, /hasRecurringDocumentDeliveryRecord/);
  assert.equal(
    isRecurringSendFollowupDue({
      approvedAtIso: '2026-01-01T00:00:00.000Z',
      nowIso: '2026-06-01T00:00:00.000Z',
      hasDeliveryRecord: true,
    }),
    false,
  );
});

test('old recurring_invoice_review work_item is not reopened on approval', () => {
  assert.match(lifecycleSource, /work_state:\s*'done'/);
  assert.doesNotMatch(lifecycleSource, /to_state:\s*'waiting_human'/);
  assert.doesNotMatch(lifecycleSource, /reopen|reopened/i);
  assert.match(bridgeSource, /emitRecurringDocumentApprovedWorkEvent/);
  assert.match(bridgeSource, /RECURRING_APPROVED_EVENT_TYPE/);
});

test('scheduler wires send-follow-up scan after recurring draft generation', () => {
  assert.match(schedulerSource, /scanRecurringDocumentSendFollowupsForOrg/);
  assert.match(schedulerSource, /recurring_send_followups_emitted/);
});

test('delivery seam is explicit TODO until DocFlow link exists', () => {
  assert.match(deliverySource, /TEMPORARY_DOCFLOW_DELIVERY_PENDING/);
  assert.match(deliverySource, /return false/);
});
