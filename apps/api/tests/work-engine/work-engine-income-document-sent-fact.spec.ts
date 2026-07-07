import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  INCOME_WORK_EVENT_DOCUMENT_SENT_BY_DOCFLOW,
  INCOME_WORK_EVENT_DOCUMENT_SENT_BY_EMAIL,
} from '../../src/domains/income/income-work-engine-bridge.pure.js';
import {
  isIncomeDocumentSentFactEventType,
  matchesRecurringSendFollowupWorkItem,
} from '../../src/domains/work-engine/work-engine-income-document-sent-fact.pure.js';
import { recurringProfileWorkPeriodKey } from '../../src/domains/work-engine/work-engine-invoice-retainer.pure.js';
import { resolveEventMapping } from '../../src/domains/work-engine/work-engine.event-mapping.service.js';

const dir = dirname(fileURLToPath(import.meta.url));
const intakeSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.event-intake.service.ts'),
  'utf8',
);
const deliverySource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-delivery.read.ts'),
  'utf8',
);
const factServiceSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-income-document-sent-fact.service.ts'),
  'utf8',
);
const emailDeliverySource = readFileSync(
  join(dir, '../../src/domains/income/income-document-email-delivery.service.ts'),
  'utf8',
);

const profileId = '11111111-1111-4111-8111-111111111111';
const otherProfileId = '22222222-2222-4222-8222-222222222222';
const cycleDateA = '2026-06-20';
const cycleDateB = '2026-06-23';
const periodKeyA = recurringProfileWorkPeriodKey(profileId, cycleDateA);
const periodKeyB = recurringProfileWorkPeriodKey(profileId, cycleDateB);

test('income document sent fact event types are recognized', () => {
  assert.equal(isIncomeDocumentSentFactEventType(INCOME_WORK_EVENT_DOCUMENT_SENT_BY_EMAIL), true);
  assert.equal(isIncomeDocumentSentFactEventType(INCOME_WORK_EVENT_DOCUMENT_SENT_BY_DOCFLOW), true);
  assert.equal(isIncomeDocumentSentFactEventType('income.document_issued'), false);
});

test('income.document_sent_by_email and docflow remain unmapped (fact consumption only)', () => {
  for (const eventType of [
    INCOME_WORK_EVENT_DOCUMENT_SENT_BY_EMAIL,
    INCOME_WORK_EVENT_DOCUMENT_SENT_BY_DOCFLOW,
  ]) {
    const mapped = resolveEventMapping({ event_type: eventType, period_key: periodKeyA });
    assert.equal(mapped.resolved, false);
  }
});

test('intake consumes income document sent facts before mapping', () => {
  assert.match(intakeSource, /isIncomeDocumentSentFactEventType/);
  assert.match(intakeSource, /consumeIncomeDocumentSentFact/);
  assert.match(intakeSource, /income_document_sent_fact_consumed/);
});

test('email sent fact completes matching recurring_document_send_followup via lifecycle completion', () => {
  assert.match(factServiceSource, /completeRecurringDocumentSendFollowupWorkItem/);
  assert.match(factServiceSource, /recurring_document_send_followup_completed/);
  assert.match(factServiceSource, /work_state:\s*'done'/);
  assert.match(factServiceSource, /generated_document_id/);
  assert.match(factServiceSource, /generated_draft_id/);
});

test('docflow sent fact uses same send-followup completion path', () => {
  assert.match(factServiceSource, /consumeIncomeDocumentSentFact/);
  assert.match(factServiceSource, /event_type: params\.eventType/);
  assert.match(factServiceSource, /channel: params\.payload\.channel/);
});

test('unrelated work item is not completed — matcher scopes profile and period_key', () => {
  const followupA = {
    module_key: 'income',
    work_type: 'recurring_document_send_followup',
    source_entity_id: profileId,
    period_key: periodKeyA,
    work_state: 'waiting_human',
  };
  const followupB = {
    module_key: 'income',
    work_type: 'recurring_document_send_followup',
    source_entity_id: profileId,
    period_key: periodKeyB,
    work_state: 'waiting_human',
  };
  const reviewItem = {
    module_key: 'income',
    work_type: 'recurring_invoice_review',
    source_entity_id: profileId,
    period_key: periodKeyA,
    work_state: 'waiting_human',
  };
  assert.equal(
    matchesRecurringSendFollowupWorkItem(followupA, {
      recurringProfileId: profileId,
      periodKey: periodKeyA,
    }),
    true,
  );
  assert.equal(
    matchesRecurringSendFollowupWorkItem(followupB, {
      recurringProfileId: profileId,
      periodKey: periodKeyA,
    }),
    false,
  );
  assert.equal(
    matchesRecurringSendFollowupWorkItem(reviewItem, {
      recurringProfileId: profileId,
      periodKey: periodKeyA,
    }),
    false,
  );
  assert.equal(
    matchesRecurringSendFollowupWorkItem(followupA, {
      recurringProfileId: otherProfileId,
      periodKey: periodKeyA,
    }),
    false,
  );
});

test('completion is idempotent when work item already done', () => {
  assert.match(
    factServiceSource,
    /if \(current\.work_state === 'done' \|\| current\.work_state === 'archived'\)/,
  );
  assert.match(intakeSource, /WORK_EVENT_DUPLICATE_SKIPPED/);
});

test('delivery read queries delivery_attempts with source_module/entity/channel/result', () => {
  assert.match(deliverySource, /from\('delivery_attempts'\)/);
  assert.match(deliverySource, /INCOME_DELIVERY_SOURCE_MODULE/);
  assert.match(deliverySource, /INCOME_DELIVERY_ENTITY_TYPE/);
  assert.match(deliverySource, /\.eq\('source_entity_id'/);
  assert.match(deliverySource, /\.in\('channel'/);
  assert.match(deliverySource, /SENT_DELIVERY_CHANNELS/);
  assert.match(deliverySource, /\.eq\('result', 'sent'\)/);
  assert.doesNotMatch(deliverySource, /TEMPORARY_DOCFLOW_DELIVERY_PENDING/);
});

test('failed delivery does not complete — facts emitted only after sent; ledger filters result=sent', () => {
  assert.match(deliverySource, /\.eq\('result', 'sent'\)/);
  assert.doesNotMatch(deliverySource, /result.*failed/);
  assert.match(emailDeliverySource, /emitIncomeWorkEventAfterDocumentSentByEmail/);
});
