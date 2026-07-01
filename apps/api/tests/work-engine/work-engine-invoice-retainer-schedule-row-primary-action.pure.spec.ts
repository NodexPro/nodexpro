import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveScheduleRowPrimaryAction } from '../../src/domains/work-engine/work-engine-invoice-retainer-schedule-row-primary-action.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const schedulePanelSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineInvoiceRetainerSchedulePanel.tsx'),
  'utf8',
);
const setupModalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineInvoiceRetainerSetupModal.tsx'),
  'utf8',
);

const base = {
  represented_client_id: 'client-1',
  profile_id: 'profile-1',
  cycle_id: 'cycle-1',
  generated_draft_id: 'draft-1',
  period_key: 'period-1',
  linked_work_item_id: 'work-1',
  scheduled_document_date: '2026-07-20',
  projected_next_document_date: '2026-07-20',
  cycle_index: 1,
  override_exists: false,
  override_scope: null as const,
};

test('waiting_review row with generated draft exposes generated_draft_review primary action', () => {
  const result = resolveScheduleRowPrimaryAction({
    ...base,
    status_key: 'waiting_review',
  });
  assert.equal(result.row_interaction_kind, 'generated_draft_review');
  assert.ok(result.primary_action);
  assert.equal(result.primary_action?.command, 'open_recurring_cycle_draft_for_review');
  if (result.primary_action?.command !== 'open_recurring_cycle_draft_for_review') return;
  assert.deepEqual(result.primary_action.payload, {
    represented_client_id: 'client-1',
    profile_id: 'profile-1',
    cycle_id: 'cycle-1',
    generated_draft_id: 'draft-1',
    period_key: 'period-1',
    linked_work_item_id: 'work-1',
  });
});

test('next document row without generated draft exposes open_next_document_tab action', () => {
  const result = resolveScheduleRowPrimaryAction({
    ...base,
    status_key: 'scheduled',
    cycle_id: null,
    generated_draft_id: null,
    linked_work_item_id: null,
    scheduled_document_date: '2026-07-20',
    projected_next_document_date: '2026-07-20',
    period_key: 'period-next',
  });
  assert.equal(result.row_interaction_kind, 'next_document_projection');
  assert.ok(result.primary_action);
  assert.equal(result.primary_action?.command, 'open_next_document_tab');
  if (result.primary_action?.command !== 'open_next_document_tab') return;
  assert.deepEqual(result.primary_action.payload, {
    target_tab: 'next_document',
    scheduled_document_date: '2026-07-20',
    period_key: 'period-next',
  });
});

test('future projection row after next document exposes cycle override primary action', () => {
  const result = resolveScheduleRowPrimaryAction({
    ...base,
    status_key: 'scheduled',
    cycle_id: null,
    generated_draft_id: null,
    linked_work_item_id: null,
    scheduled_document_date: '2026-08-20',
    projected_next_document_date: '2026-07-20',
    period_key: 'period-future',
    cycle_index: 2,
  });
  assert.equal(result.row_interaction_kind, 'future_projection');
  assert.ok(result.primary_action);
  assert.equal(result.primary_action?.command, 'open_recurring_cycle_override_for_edit');
  if (result.primary_action?.command !== 'open_recurring_cycle_override_for_edit') return;
  assert.deepEqual(result.primary_action.payload, {
    represented_client_id: 'client-1',
    profile_id: 'profile-1',
    cycle_date: '2026-08-20',
    period_key: 'period-future',
    cycle_index: 2,
  });
  assert.ok(result.preview_action?.visible);
});

test('row without generated_draft_id and without next-document match has no open action', () => {
  const result = resolveScheduleRowPrimaryAction({
    ...base,
    status_key: 'waiting_review',
    generated_draft_id: null,
    cycle_id: null,
    projected_next_document_date: null,
  });
  assert.equal(result.row_interaction_kind, null);
  assert.equal(result.primary_action, null);
});

test('generated draft review keeps priority over next-document projection', () => {
  const result = resolveScheduleRowPrimaryAction({
    ...base,
    status_key: 'waiting_review',
    scheduled_document_date: '2026-07-20',
    projected_next_document_date: '2026-07-20',
  });
  assert.equal(result.row_interaction_kind, 'generated_draft_review');
  assert.equal(result.primary_action?.command, 'open_recurring_cycle_draft_for_review');
});

test('frontend schedule handler switches tab only for open_next_document_tab', () => {
  assert.ok(setupModalSource.includes('handleScheduleRowPrimaryAction'));
  assert.ok(setupModalSource.includes("action.command === 'open_next_document_tab'"));
  assert.ok(setupModalSource.includes("setActiveSetupTab('next_document')"));
  const handlerStart = setupModalSource.indexOf('const handleScheduleRowPrimaryAction');
  const handlerEnd = setupModalSource.indexOf('const handleCycleOverrideSetupSaved', handlerStart);
  const handlerBlock = setupModalSource.slice(handlerStart, handlerEnd);
  assert.ok(handlerBlock.includes('open_recurring_cycle_draft_for_review'));
  assert.ok(handlerBlock.includes('open_recurring_cycle_override_for_edit'));
  assert.ok(handlerBlock.includes('WorkEngineRecurringCycleOverrideModal') || setupModalSource.includes('WorkEngineRecurringCycleOverrideModal'));
  assert.ok(!handlerBlock.includes('refreshSetupAggregate'));
  assert.ok(!handlerBlock.includes("setActiveSetupTab('retainer')"));
});

test('frontend schedule panel does not infer next row by date', () => {
  assert.ok(!schedulePanelSource.includes('projected_next_document_date'));
  assert.ok(!schedulePanelSource.includes('projectedNextDocumentDate'));
  assert.ok(!schedulePanelSource.includes('resolveNext'));
  assert.ok(schedulePanelSource.includes('onScheduleRowPrimaryAction'));
  assert.ok(schedulePanelSource.includes('row.primary_action'));
  assert.ok(schedulePanelSource.includes('open_recurring_cycle_override_for_edit'));
});
