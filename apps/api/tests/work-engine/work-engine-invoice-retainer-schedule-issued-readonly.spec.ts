import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveScheduleRowStatus } from '../../src/domains/work-engine/work-engine-invoice-retainer-schedule-row-status.pure.js';
import { resolveScheduleRowPrimaryAction } from '../../src/domains/work-engine/work-engine-invoice-retainer-schedule-row-primary-action.pure.js';
import {
  buildIssuedScheduleRowMenuActions,
  issuedScheduleRowAllowedActionKeys,
} from '../../src/domains/work-engine/work-engine-invoice-retainer-schedule-issued-actions.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const cyclesServiceSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-cycles.service.ts'),
  'utf8',
);
const projectionServiceSource = readFileSync(
  join(
    dir,
    '../../src/domains/work-engine/work-engine-invoice-retainer-schedule-projection.service.ts',
  ),
  'utf8',
);
const machineIndicatorSource = readFileSync(
  join(
    dir,
    '../../../web/src/components/work-engine/WorkEngineInvoiceRetainerScheduleMachineIndicator.tsx',
  ),
  'utf8',
);
const migration142 = readFileSync(
  join(dir, '../../../../supabase/migrations/142_income_recurring_document_cycles.sql'),
  'utf8',
);

test('issued row status_key is issued with הופק label', () => {
  const status = resolveScheduleRowStatus({
    cycle: {
      status: 'issued',
      generated_draft_id: 'draft-1',
      generated_document_id: 'doc-1',
    },
    workItem: null,
  });
  assert.equal(status.status_key, 'issued');
  assert.equal(status.status_label, 'הופק');
  assert.equal(status.has_open_task, false);
  assert.equal(status.work_item_href, null);
});

test('issued row has no edit/save/issue primary action', () => {
  const result = resolveScheduleRowPrimaryAction({
    status_key: 'issued',
    scheduled_document_date: '2026-08-01',
    projected_next_document_date: '2026-09-23',
    represented_client_id: 'client-1',
    profile_id: 'profile-1',
    cycle_id: 'cycle-1',
    generated_draft_id: 'draft-1',
    period_key: 'retainer:profile:profile-1:cycle:2026-08-01',
    linked_work_item_id: null,
    cycle_index: 1,
    override_exists: false,
    override_scope: null,
  });
  assert.equal(result.row_interaction_kind, null);
  assert.equal(result.primary_action, null);
  assert.equal(result.preview_action, null);
});

test('issued row menu is read-only open_document only when document exists', () => {
  const actions = buildIssuedScheduleRowMenuActions({
    generatedDocumentId: 'doc-aug',
    documentDownloadPath: (id) => `/api/v1/income/documents/${id}/download`,
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.key, 'open_document');
  assert.equal(actions[0]?.label, 'צפייה במסמך');
  assert.equal(actions[0]?.disabled, false);
  assert.equal(actions[0]?.href, '/api/v1/income/documents/doc-aug/download');
  assert.equal(actions[0]?.income_command, null);
  assert.deepEqual(issuedScheduleRowAllowedActionKeys(actions), ['open_document']);
  assert.ok(!actions.some((a) => /edit|save|issue|override/i.test(a.key)));
});

test('issued row without document id keeps open_document disabled only', () => {
  const actions = buildIssuedScheduleRowMenuActions({
    generatedDocumentId: null,
    documentDownloadPath: (id) => `/api/v1/income/documents/${id}/download`,
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.disabled, true);
  assert.deepEqual(issuedScheduleRowAllowedActionKeys(actions), []);
});

test('projection service wires issued read-only menu and generated_document_id', () => {
  assert.match(projectionServiceSource, /buildIssuedScheduleRowMenuActions/);
  assert.match(projectionServiceSource, /statusKey === 'issued'/);
  assert.match(projectionServiceSource, /generated_document_id: cycle\?\.generated_document_id/);
  assert.match(
    projectionServiceSource,
    /allowed_actions: actions\.filter\(\(action\) => !action\.disabled\)/,
  );
  assert.ok(!projectionServiceSource.includes("statusKey === 'issued') {\n    return [openDocument, viewHistory]"));
});

test('frontend keeps muted lifecycle indicators for issued rows', () => {
  assert.match(machineIndicatorSource, /statusKey === 'issued'/);
  assert.match(machineIndicatorSource, /machine-indicator--readonly/);
  assert.match(machineIndicatorSource, /הופק/);
});

test('DB unique is exact scheduled_document_date not calendar month', () => {
  assert.match(
    migration142,
    /unique \(organization_id, recurring_profile_id, scheduled_document_date\)/,
  );
  assert.doesNotMatch(migration142, /period_key|YYYY-MM|calendar_month/);
});

test('replay linkRecurringCycleIssuedDocument updates same cycle (no duplicate create)', () => {
  assert.match(cyclesServiceSource, /export async function linkRecurringCycleIssuedDocument/);
  assert.match(cyclesServiceSource, /Safe to call repeatedly/);
  assert.match(cyclesServiceSource, /\.update\(\{\s*status: 'issued'/);
  assert.doesNotMatch(
    cyclesServiceSource.slice(
      cyclesServiceSource.indexOf('linkRecurringCycleIssuedDocument'),
      cyclesServiceSource.indexOf('linkRecurringCycleIssuedDocument') + 2500,
    ),
    /\.insert\(/,
  );
});
