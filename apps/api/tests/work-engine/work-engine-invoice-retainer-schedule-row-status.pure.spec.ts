import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECURRING_FAILURE_WORK_TYPE,
  RECURRING_WORK_TYPE,
} from '../../src/domains/work-engine/work-engine-invoice-retainer.pure.js';
import { resolveScheduleRowStatus } from '../../src/domains/work-engine/work-engine-invoice-retainer-schedule-row-status.pure.js';

test('scheduled row when no cycle exists', () => {
  const status = resolveScheduleRowStatus({ cycle: null, workItem: null });
  assert.equal(status.status_key, 'scheduled');
  assert.equal(status.status_label, 'מתוכנן');
  assert.equal(status.icon_display, '📅');
});

test('waiting_review when draft exists without issued document', () => {
  const status = resolveScheduleRowStatus({
    cycle: {
      status: 'draft_created',
      generated_draft_id: 'draft-1',
      generated_document_id: null,
    },
    workItem: {
      work_item_id: 'wi-1',
      work_type: RECURRING_WORK_TYPE,
      work_state: 'waiting_human',
      period_key: 'retainer:profile:p1:cycle:2026-07-23',
    },
  });
  assert.equal(status.status_key, 'waiting_review');
  assert.equal(status.status_label, 'ממתין לבדיקה');
  assert.equal(status.icon_display, '📝');
  assert.equal(status.has_open_task, true);
  assert.equal(status.work_state_label, null);
  assert.match(status.work_item_href ?? '', /work_item_id=wi-1/);
});

test('issued only when generated_document_id exists', () => {
  const status = resolveScheduleRowStatus({
    cycle: {
      status: 'draft_created',
      generated_draft_id: 'draft-1',
      generated_document_id: 'doc-1',
    },
    workItem: null,
  });
  assert.equal(status.status_key, 'issued');
  assert.equal(status.icon_display, '✓');
});

test('failed from cycle status', () => {
  const status = resolveScheduleRowStatus({
    cycle: {
      status: 'failed',
      generated_draft_id: null,
      generated_document_id: null,
    },
    workItem: null,
  });
  assert.equal(status.status_key, 'failed');
  assert.equal(status.icon_display, '⚠');
});

test('failed from generation failed work item without cycle', () => {
  const status = resolveScheduleRowStatus({
    cycle: null,
    workItem: {
      work_item_id: 'wi-fail',
      work_type: RECURRING_FAILURE_WORK_TYPE,
      work_state: 'new',
      period_key: 'retainer:profile:p1:cycle:2026-08-22',
    },
  });
  assert.equal(status.status_key, 'failed');
});

test('skipped from cancelled cycle', () => {
  const status = resolveScheduleRowStatus({
    cycle: {
      status: 'cancelled',
      generated_draft_id: null,
      generated_document_id: null,
    },
    workItem: null,
  });
  assert.equal(status.status_key, 'skipped');
  assert.equal(status.status_tone, 'muted');
});

test('draft without issued document is not check', () => {
  const status = resolveScheduleRowStatus({
    cycle: {
      status: 'draft_created',
      generated_draft_id: 'draft-1',
      generated_document_id: null,
    },
    workItem: null,
  });
  assert.notEqual(status.status_key, 'issued');
  assert.equal(status.status_key, 'waiting_review');
});
