import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isOfficeAttentionExcludedWorkType,
  officePeriodLabel,
  officeTaskDescription,
  officeWorkTypeLabel,
  parseOfficeTaskListKey,
  sanitizeOfficeTaskSearchToken,
  workItemMatchesOfficeAttention,
} from '../../src/domains/dashboard/dashboard-office-tasks.pure.js';

const TODAY = {
  start_iso: '2026-11-26T22:00:00.000Z',
  end_exclusive_iso: '2026-11-27T22:00:00.000Z',
};

test('parseOfficeTaskListKey accepts only dashboard attention buckets', () => {
  assert.equal(parseOfficeTaskListKey('overdue'), 'overdue');
  assert.equal(parseOfficeTaskListKey('due_today'), 'due_today');
  assert.equal(parseOfficeTaskListKey('review_pending'), 'review_pending');
  assert.equal(parseOfficeTaskListKey('new'), null);
  assert.equal(parseOfficeTaskListKey('assigned'), null);
});

test('human task titles never concatenate work_type and period_key codes', () => {
  assert.equal(officeWorkTypeLabel('annual_report_docs', 'he'), 'מסמכים לדוח שנתי');
  assert.equal(officeWorkTypeLabel('annual_report_docs', 'en'), 'Annual report documents');
  assert.equal(officeWorkTypeLabel('capital_declaration_docs', 'he'), 'מסמכים להצהרת הון');
  assert.equal(officeWorkTypeLabel('capital_declaration_docs', 'en'), 'Capital declaration documents');
  assert.equal(officeWorkTypeLabel('vat_material', 'he'), 'חומר למע״מ');
  assert.equal(officeWorkTypeLabel('payroll_material', 'he'), 'חומר לשכר');
  assert.equal(officePeriodLabel('client_operations:annual_report:2026'), '2026');
  assert.equal(
    officeTaskDescription({
      moduleKey: 'client_operations',
      periodKey: 'client_operations:annual_report:2026',
      locale: 'he',
    }),
    'ניהול לקוחות · 2026',
  );
  assert.doesNotMatch(officeWorkTypeLabel('annual_report_docs', 'he'), /annual_report_docs/);
  assert.doesNotMatch(
    officeTaskDescription({
      moduleKey: 'client_operations',
      periodKey: 'client_operations:annual_report:2026',
      locale: 'en',
    }),
    /client_operations:annual_report:2026/,
  );
});

test('overdue attention includes past-due active Work Engine items, not only work_state=overdue', () => {
  assert.equal(
    workItemMatchesOfficeAttention({
      listKey: 'overdue',
      workState: 'assigned',
      slaStatus: 'on_track',
      dueAt: '2026-11-20T10:00:00.000Z',
      today: TODAY,
    }),
    true,
  );
  assert.equal(
    workItemMatchesOfficeAttention({
      listKey: 'overdue',
      workState: 'new',
      slaStatus: 'overdue',
      dueAt: null,
      today: TODAY,
    }),
    true,
  );
  assert.equal(
    workItemMatchesOfficeAttention({
      listKey: 'overdue',
      workState: 'assigned',
      slaStatus: 'on_track',
      dueAt: null,
      today: TODAY,
    }),
    false,
  );
  assert.equal(
    workItemMatchesOfficeAttention({
      listKey: 'overdue',
      workState: 'done',
      slaStatus: 'overdue',
      dueAt: '2026-11-20T10:00:00.000Z',
      today: TODAY,
    }),
    false,
  );
});

test('due today and review pending stay Work Engine field filters', () => {
  assert.equal(
    workItemMatchesOfficeAttention({
      listKey: 'due_today',
      workState: 'assigned',
      slaStatus: 'on_track',
      dueAt: '2026-11-27T08:00:00.000Z',
      today: TODAY,
    }),
    true,
  );
  assert.equal(
    workItemMatchesOfficeAttention({
      listKey: 'review_pending',
      workState: 'review_pending',
      slaStatus: 'none',
      dueAt: null,
      today: TODAY,
    }),
    true,
  );
  assert.equal(
    workItemMatchesOfficeAttention({
      listKey: 'review_pending',
      workState: 'assigned',
      slaStatus: 'none',
      dueAt: null,
      today: TODAY,
    }),
    false,
  );
});

test('search tokens cannot inject PostgREST wildcards', () => {
  assert.equal(sanitizeOfficeTaskSearchToken('Test 7'), 'Test 7');
  assert.equal(sanitizeOfficeTaskSearchToken('a%b,c(d)'), 'a b c d');
});

test('Dashboard Attention excludes VAT/Payroll material work types and keeps annual/capital docs', () => {
  assert.equal(isOfficeAttentionExcludedWorkType('vat_material'), true);
  assert.equal(isOfficeAttentionExcludedWorkType('payroll_material'), true);
  assert.equal(isOfficeAttentionExcludedWorkType('annual_report_docs'), false);
  assert.equal(isOfficeAttentionExcludedWorkType('capital_declaration_docs'), false);
  assert.equal(
    workItemMatchesOfficeAttention({
      listKey: 'due_today',
      workState: 'waiting_client',
      slaStatus: 'on_track',
      dueAt: '2026-11-27T08:00:00.000Z',
      today: TODAY,
      workType: 'vat_material',
    }),
    false,
  );
  assert.equal(
    workItemMatchesOfficeAttention({
      listKey: 'due_today',
      workState: 'waiting_client',
      slaStatus: 'on_track',
      dueAt: '2026-11-27T08:00:00.000Z',
      today: TODAY,
      workType: 'capital_declaration_docs',
    }),
    true,
  );
});
