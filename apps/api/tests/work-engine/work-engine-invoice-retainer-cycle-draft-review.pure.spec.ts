import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateCycleDraftReviewRefs } from '../../src/domains/work-engine/work-engine-invoice-retainer-cycle-draft-review.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const setupModalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineInvoiceRetainerSetupModal.tsx'),
  'utf8',
);
const commandsSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer.commands.service.ts'),
  'utf8',
);
const cycleReviewServiceSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-cycle-draft-review.service.ts'),
  'utf8',
);

const validBase = {
  profile_id: 'profile-1',
  cycle_profile_id: 'profile-1',
  cycle_id: 'cycle-1',
  requested_cycle_id: 'cycle-1',
  cycle_generated_draft_id: 'draft-1',
  requested_draft_id: 'draft-1',
  draft_organization_id: 'org-1',
  expected_organization_id: 'org-1',
  draft_represented_client_id: 'client-1',
  expected_represented_client_id: 'client-1',
};

test('validateCycleDraftReviewRefs accepts matching profile/cycle/draft/org/client', () => {
  const result = validateCycleDraftReviewRefs(validBase);
  assert.deepEqual(result, { ok: true });
});

test('validateCycleDraftReviewRefs rejects wrong profile/cycle/draft combination', () => {
  assert.deepEqual(
    validateCycleDraftReviewRefs({ ...validBase, cycle_profile_id: 'other-profile' }),
    { ok: false, reason: 'cycle_profile_mismatch' },
  );
  assert.deepEqual(
    validateCycleDraftReviewRefs({ ...validBase, requested_cycle_id: 'other-cycle' }),
    { ok: false, reason: 'cycle_id_mismatch' },
  );
  assert.deepEqual(
    validateCycleDraftReviewRefs({ ...validBase, requested_draft_id: 'other-draft' }),
    { ok: false, reason: 'cycle_draft_mismatch' },
  );
});

test('validateCycleDraftReviewRefs rejects draft from another org/client', () => {
  assert.deepEqual(
    validateCycleDraftReviewRefs({ ...validBase, draft_organization_id: 'other-org' }),
    { ok: false, reason: 'draft_org_mismatch' },
  );
  assert.deepEqual(
    validateCycleDraftReviewRefs({ ...validBase, draft_represented_client_id: 'other-client' }),
    { ok: false, reason: 'draft_client_mismatch' },
  );
});

test('open cycle draft review command returns dedicated aggregate not setup aggregate', () => {
  assert.ok(commandsSource.includes('work_engine_recurring_cycle_draft_review_aggregate'));
  assert.ok(cycleReviewServiceSource.includes("aggregate_key: 'work_engine_recurring_cycle_draft_review_aggregate'"));
  assert.ok(!cycleReviewServiceSource.includes('buildWorkEngineInvoiceRetainerSetupAggregate'));
});

test('schedule icon click does not switch to retainer tab or refresh setup aggregate', () => {
  assert.ok(setupModalSource.includes('handleOpenCycleDraftForReview'));
  assert.ok(setupModalSource.includes('work_engine_recurring_cycle_draft_review_aggregate'));
  assert.ok(!setupModalSource.includes('handleOpenGeneratedDraftForReview'));
  assert.ok(!setupModalSource.includes("setActiveSetupTab('retainer')"));
  const handlerStart = setupModalSource.indexOf('const handleOpenCycleDraftForReview');
  const handlerEnd = setupModalSource.indexOf('const handleGeneratePreview', handlerStart);
  const handlerBlock = setupModalSource.slice(handlerStart, handlerEnd);
  assert.ok(!handlerBlock.includes('refreshSetupAggregate'));
  assert.ok(!handlerBlock.includes("setActiveSetupTab('retainer')"));
});
