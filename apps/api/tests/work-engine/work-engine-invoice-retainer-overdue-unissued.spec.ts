/**
 * Overdue unissued recurring schedule lifecycle + issue-date bounds.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OVERDUE_UNISSUED_STATUS_KEY,
  OVERDUE_UNISSUED_STATUS_LABEL,
  assertIssueDateNotBeforeMin,
  buildOverdueUnissuedIssueDateBounds,
  clampIssueDateNotBeforeMin,
  isRecurringScheduleDateOverdue,
} from '../../src/domains/work-engine/work-engine-invoice-retainer-overdue-issue-date.pure.js';
import { resolveScheduleRowStatus } from '../../src/domains/work-engine/work-engine-invoice-retainer-schedule-row-status.pure.js';
import { resolveScheduleRowPrimaryAction } from '../../src/domains/work-engine/work-engine-invoice-retainer-schedule-row-primary-action.pure.js';
import { buildIssueMonthSelector } from '../../src/domains/work-engine/work-engine-invoice-retainer-issue-month-selector.pure.js';
import { buildCycleDraftReviewIssueAction } from '../../src/domains/work-engine/work-engine-invoice-retainer-cycle-draft-review-actions.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const projectionSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-schedule-projection.service.ts'),
  'utf8',
);
const panelSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineInvoiceRetainerSchedulePanel.tsx'),
  'utf8',
);

test('past scheduled date without cycle becomes not_issued (לא הופק)', () => {
  const status = resolveScheduleRowStatus({
    cycle: null,
    workItem: null,
    scheduled_document_date: '2026-07-23',
    today_iso: '2026-08-07',
  });
  assert.equal(status.status_key, OVERDUE_UNISSUED_STATUS_KEY);
  assert.equal(status.status_label, OVERDUE_UNISSUED_STATUS_LABEL);
  assert.equal(status.status_tone, 'warning');
  assert.equal(status.icon_key, 'alert');
});

test('today or future remains scheduled (מתוכנן)', () => {
  const today = resolveScheduleRowStatus({
    cycle: null,
    workItem: null,
    scheduled_document_date: '2026-08-07',
    today_iso: '2026-08-07',
  });
  assert.equal(today.status_key, 'scheduled');
  assert.equal(today.status_label, 'מתוכנן');

  const future = resolveScheduleRowStatus({
    cycle: null,
    workItem: null,
    scheduled_document_date: '2026-09-01',
    today_iso: '2026-08-07',
  });
  assert.equal(future.status_key, 'scheduled');
});

test('issued / waiting_review unchanged even when scheduled date is past', () => {
  const issued = resolveScheduleRowStatus({
    cycle: {
      status: 'issued',
      generated_draft_id: 'd1',
      generated_document_id: 'doc1',
    },
    workItem: null,
    scheduled_document_date: '2026-07-23',
    today_iso: '2026-08-07',
  });
  assert.equal(issued.status_key, 'issued');

  const review = resolveScheduleRowStatus({
    cycle: {
      status: 'draft_created',
      generated_draft_id: 'd1',
      generated_document_id: null,
    },
    workItem: null,
    scheduled_document_date: '2026-07-23',
    today_iso: '2026-08-07',
  });
  assert.equal(review.status_key, 'waiting_review');
});

test('not_issued row exposes open_next_document_tab primary action', () => {
  const result = resolveScheduleRowPrimaryAction({
    status_key: 'not_issued',
    scheduled_document_date: '2026-07-23',
    projected_next_document_date: '2026-08-23',
    represented_client_id: 'c1',
    profile_id: 'p1',
    cycle_id: null,
    generated_draft_id: null,
    period_key: 'period-overdue',
    linked_work_item_id: null,
    cycle_index: 0,
    override_exists: false,
    override_scope: null,
  });
  assert.equal(result.row_interaction_kind, 'overdue_unissued');
  assert.equal(result.primary_action?.command, 'open_next_document_tab');
});

test('overdue issue date bounds: default and min are today; past forbidden', () => {
  assert.equal(isRecurringScheduleDateOverdue('2026-07-23', '2026-08-07'), true);
  assert.equal(isRecurringScheduleDateOverdue('2026-08-07', '2026-08-07'), false);
  const bounds = buildOverdueUnissuedIssueDateBounds('2026-08-07');
  assert.equal(bounds.issue_default_date, '2026-08-07');
  assert.equal(bounds.issue_min_date, '2026-08-07');
  assert.equal(bounds.issue_max_date, null);
  assert.equal(clampIssueDateNotBeforeMin('2026-07-23', '2026-08-07'), '2026-08-07');
  assert.equal(clampIssueDateNotBeforeMin('2026-08-15', '2026-08-07'), '2026-08-15');
  assert.throws(() => assertIssueDateNotBeforeMin('2026-08-01', '2026-08-07'));
});

test('overdue issue month selector excludes past months and defaults to current', () => {
  const selector = buildIssueMonthSelector({
    todayIso: '2026-08-07',
    documentDate: '2026-07-23',
    mode: 'issue',
    monthsBack: 2,
    monthsAhead: 2,
    overdueUnissued: true,
  });
  assert.equal(selector.default_month, '2026-08');
  assert.ok(!selector.allowed_months.some((m) => m.month_key === '2026-07'));
  assert.ok(selector.allowed_months.some((m) => m.month_key === '2026-08'));
  assert.equal(selector.issue_min_date, '2026-08-07');
  assert.equal(selector.issue_default_date, '2026-08-07');
});

test('cycle draft issue action exposes overdue date bounds when scheduled date is past', () => {
  const action = buildCycleDraftReviewIssueAction({
    document_type: 'tax_invoice',
    can_issue: true,
    issue_blocked_reason: null,
    document_date: '2026-07-23',
    already_issued: false,
    issued_document_number_display: null,
    today_iso: '2026-08-07',
    issue_month_window: { months_back: 2, months_ahead: 2 },
    scheduled_document_date: '2026-07-23',
  });
  assert.equal(action.enabled, true);
  assert.equal(action.issue_default_date, '2026-08-07');
  assert.equal(action.issue_min_date, '2026-08-07');
  assert.ok(action.issue_month_selector);
  assert.ok(!action.issue_month_selector!.allowed_months.some((m) => m.month_key === '2026-07'));
});

test('projection wires not_issued menu path; FE still hides only empty actions', () => {
  assert.match(projectionSource, /status_key === 'not_issued'/);
  assert.match(projectionSource, /buildOverdueUnissuedIssueDateBounds/);
  assert.match(panelSource, /actions\.length === 0\) return null/);
});

test('schedule status layout uses fixed indicator column and stacked squares', () => {
  const indicatorSource = readFileSync(
    join(
      dir,
      '../../../web/src/components/work-engine/WorkEngineInvoiceRetainerScheduleMachineIndicator.tsx',
    ),
    'utf8',
  );
  const cssSource = readFileSync(
    join(dir, '../../../web/src/styles/nx-work-engine-invoice-retainer.css'),
    'utf8',
  );
  assert.match(indicatorSource, /nx-we-retainer-schedule__lifecycle-stack/);
  assert.match(indicatorSource, /lifecycle-square/);
  assert.match(cssSource, /status-indicator-col/);
  assert.match(cssSource, /flex-direction:\s*column/);
  assert.match(cssSource, /gap:\s*16px/);
  assert.match(cssSource, /flex:\s*0 0 40px/);
});

test('overdue confirm modal uses backend min/default date calendar bounds', () => {
  const confirmSource = readFileSync(
    join(dir, '../../../web/src/components/work-engine/WorkEngineCycleDraftReviewConfirmModal.tsx'),
    'utf8',
  );
  assert.match(confirmSource, /type="date"/);
  assert.match(confirmSource, /issue_min_date/);
  assert.match(confirmSource, /issue_default_date/);
  assert.match(confirmSource, /document_date/);
  assert.doesNotMatch(confirmSource, /new Date\(\)/);
});
