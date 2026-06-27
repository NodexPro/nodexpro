import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveScheduleRowPrimaryAction } from '../../src/domains/work-engine/work-engine-invoice-retainer-schedule-row-primary-action.pure.js';

const base = {
  represented_client_id: 'client-1',
  profile_id: 'profile-1',
  cycle_id: 'cycle-1',
  generated_draft_id: 'draft-1',
  period_key: 'period-1',
  linked_work_item_id: 'work-1',
};

test('waiting_review row with generated draft exposes generated_draft_review primary action', () => {
  const result = resolveScheduleRowPrimaryAction({
    ...base,
    status_key: 'waiting_review',
  });
  assert.equal(result.row_interaction_kind, 'generated_draft_review');
  assert.ok(result.primary_action);
  assert.equal(result.primary_action?.command, 'open_recurring_cycle_draft_for_review');
  assert.deepEqual(result.primary_action?.payload, {
    represented_client_id: 'client-1',
    profile_id: 'profile-1',
    cycle_id: 'cycle-1',
    generated_draft_id: 'draft-1',
    period_key: 'period-1',
    linked_work_item_id: 'work-1',
  });
});

test('row without generated_draft_id does not expose open action', () => {
  const result = resolveScheduleRowPrimaryAction({
    ...base,
    status_key: 'waiting_review',
    generated_draft_id: null,
    cycle_id: null,
  });
  assert.equal(result.row_interaction_kind, null);
  assert.equal(result.primary_action, null);
});

test('scheduled row with draft does not expose open action', () => {
  const result = resolveScheduleRowPrimaryAction({
    ...base,
    status_key: 'scheduled',
  });
  assert.equal(result.row_interaction_kind, null);
  assert.equal(result.primary_action, null);
});
