/**
 * Recurring document scheduler — failure retry / cycle-key semantics.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  advanceServicePeriod,
  buildRecurringSchedulerCycleKey,
  isRecurringProfileDueForDraftGeneration,
} from '../../src/domains/work-engine/work-engine-invoice-retainer.pure.js';
import {
  buildRecurringGenerationFailedProfileUpdate,
  buildRecurringGenerationSuccessProfileUpdate,
  isRecurringSchedulerPeriodProcessed,
  shouldReuseExistingCycleDraft,
} from '../../src/domains/work-engine/work-engine-invoice-retainer.scheduler.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const schedulerSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer.scheduler.service.ts'),
  'utf8',
);
const cyclesSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-cycles.service.ts'),
  'utf8',
);
const bridgeSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-bridge.ts'),
  'utf8',
);
const mig142 = readFileSync(
  join(dir, '../../../../supabase/migrations/142_income_recurring_document_cycles.sql'),
  'utf8',
);

const profileId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const scheduledDate = '2026-08-01';
const cycleKey = buildRecurringSchedulerCycleKey(profileId, scheduledDate);

test('1) success stamps last_scheduler_cycle_key and advances next_document_date', () => {
  const currentNextDocumentDate = '2026-07-01';
  const successCycleKey = buildRecurringSchedulerCycleKey(profileId, currentNextDocumentDate);
  const advanced = advanceServicePeriod({
    service_period_start: '2026-07-01',
    service_period_end: '2026-07-31',
    frequency: 'monthly',
  });
  const patch = buildRecurringGenerationSuccessProfileUpdate({
    draftId: 'draft-1',
    generatedAtIso: '2026-07-25T10:00:00.000Z',
    cycleKey: successCycleKey,
    nextDocumentDate: advanced.next_document_date,
    servicePeriodStart: advanced.service_period_start,
    servicePeriodEnd: advanced.service_period_end,
    unitPriceBeforeVatReference: 100,
  });

  assert.equal(patch.last_scheduler_cycle_key, successCycleKey);
  assert.equal(patch.next_document_date, '2026-08-01');
  assert.notEqual(patch.next_document_date, currentNextDocumentDate);
  assert.equal(patch.last_generation_failed_at, null);
  assert.match(schedulerSource, /buildRecurringGenerationSuccessProfileUpdate/);
  assert.match(schedulerSource, /advanceProfileAfterSuccess/);
});

test('2) failure does NOT stamp last_scheduler_cycle_key; next_document_date unchanged; failure metadata recorded', () => {
  const failed = buildRecurringGenerationFailedProfileUpdate({
    failedAtIso: '2026-07-25T10:00:00.000Z',
    errorCode: 'DRAFT_CREATION_FAILED',
    errorMessage: 'boom',
  });

  assert.equal('last_scheduler_cycle_key' in failed, false);
  assert.equal(failed.last_generation_failed_at, '2026-07-25T10:00:00.000Z');
  assert.equal(failed.last_generation_error_code, 'DRAFT_CREATION_FAILED');
  assert.equal(failed.last_generation_error_message, 'boom');

  assert.match(schedulerSource, /buildRecurringGenerationFailedProfileUpdate/);
  assert.match(schedulerSource, /Do NOT stamp last_scheduler_cycle_key on failure/);
  assert.doesNotMatch(
    schedulerSource,
    /markProfileGenerationFailed[\s\S]*?last_scheduler_cycle_key:\s*params\.cycleKey/,
  );
  // Failure path keeps next_document_date on profile (not in failed patch).
  assert.equal(Object.hasOwn(failed, 'next_document_date'), false);
});

test('3) next scheduler run after failure selects the same profile/period again', () => {
  const lastKeyAfterFailure: string | null = null;
  assert.equal(isRecurringSchedulerPeriodProcessed(lastKeyAfterFailure, cycleKey), false);

  const due = isRecurringProfileDueForDraftGeneration({
    today_iso: '2026-07-25',
    next_document_date: scheduledDate,
    advance_days: 7,
  });
  assert.equal(due, true);

  // Simulated prior bug: failure stamped key → permanently skipped.
  assert.equal(isRecurringSchedulerPeriodProcessed(cycleKey, cycleKey), true);
});

test('4) retry with existing failed cycle reuses cycle row (no duplicate insert path)', () => {
  assert.match(cyclesSource, /findCycleByScheduledDate/);
  assert.match(cyclesSource, /recordRecurringCycleDraftCreated/);
  assert.match(cyclesSource, /recordRecurringCycleFailed/);
  assert.match(cyclesSource, /if \(existing\)/);
  assert.match(mig142, /unique\s*\(\s*organization_id,\s*recurring_profile_id,\s*scheduled_document_date\s*\)/i);
  assert.match(schedulerSource, /findReusableGeneratedDraftIdForScheduledCycle/);
});

test('5) retry eventually succeeds: stamps key only after success; advances once', () => {
  // After failure: still due, not processed.
  assert.equal(isRecurringSchedulerPeriodProcessed(null, cycleKey), false);

  const advanced = advanceServicePeriod({
    service_period_start: '2026-07-01',
    service_period_end: '2026-07-31',
    frequency: 'monthly',
  });
  const success = buildRecurringGenerationSuccessProfileUpdate({
    draftId: 'draft-retry',
    generatedAtIso: '2026-07-26T10:00:00.000Z',
    cycleKey,
    nextDocumentDate: advanced.next_document_date,
    servicePeriodStart: advanced.service_period_start,
    servicePeriodEnd: advanced.service_period_end,
    unitPriceBeforeVatReference: 100,
  });

  assert.equal(success.last_scheduler_cycle_key, cycleKey);
  assert.equal(isRecurringSchedulerPeriodProcessed(success.last_scheduler_cycle_key, cycleKey), true);

  // Same period key vs advanced next date → old period skipped; new period not yet due until advance window.
  const oldPeriodStillProcessed = isRecurringSchedulerPeriodProcessed(
    success.last_scheduler_cycle_key,
    buildRecurringSchedulerCycleKey(profileId, scheduledDate),
  );
  assert.equal(oldPeriodStillProcessed, true);
});

test('6) repeated scheduler calls after success skip same period (no duplicate)', () => {
  assert.equal(isRecurringSchedulerPeriodProcessed(cycleKey, cycleKey), true);
  assert.match(schedulerSource, /isRecurringSchedulerPeriodProcessed/);
  assert.match(bridgeSource, /idempotency_key:\s*`retainer:draft:\$\{signal\.recurringProfileId\}:\$\{signal\.scheduledDocumentDate\}`/);
});

test('orphan draft reuse: only when cycle points at an active draft', () => {
  assert.equal(
    shouldReuseExistingCycleDraft({ cycleGeneratedDraftId: 'd1', draftStatus: 'draft' }),
    true,
  );
  assert.equal(
    shouldReuseExistingCycleDraft({ cycleGeneratedDraftId: 'd1', draftStatus: 'issued' }),
    false,
  );
  assert.equal(
    shouldReuseExistingCycleDraft({ cycleGeneratedDraftId: null, draftStatus: 'draft' }),
    false,
  );
  assert.match(cyclesSource, /findReusableGeneratedDraftIdForScheduledCycle/);
  assert.match(schedulerSource, /reusableDraftId \?\?/);
});

test('work_event intake failure remains swallowed after successful generation (gap documented)', () => {
  assert.match(bridgeSource, /emitRecurringDocumentDraftCreatedWorkEvent/);
  assert.match(bridgeSource, /await auditBridgeFailure/);
  assert.match(bridgeSource, /return null/);
  // No dedicated re-emit/recovery command in bridge.
  assert.doesNotMatch(bridgeSource, /reemit|re-emit|recoverDraftCreated|replayIntake/i);
  // Scheduler still advances before emit — intake failure does not roll back cycle key.
  const advanceIdx = schedulerSource.indexOf('await advanceProfileAfterSuccess');
  const emitIdx = schedulerSource.indexOf('await emitRecurringDocumentDraftCreatedWorkEvent');
  assert.ok(advanceIdx > 0 && emitIdx > advanceIdx);
});
