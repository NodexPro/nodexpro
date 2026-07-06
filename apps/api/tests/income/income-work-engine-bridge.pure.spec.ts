import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INCOME_WORK_EVENT_DOCUMENT_SENT_BY_EMAIL,
  INCOME_WORK_EVENT_DOCUMENT_ISSUED,
  INCOME_WORK_EVENT_DUE_DATE_SET,
  INCOME_WORK_EVENT_OVERDUE,
  INCOME_WORK_EVENTS_DEFERRED,
  amountReferenceFromTotalsSnapshot,
  incomeDocumentPeriodKey,
  isOverdueByDueDate,
  resolveIncomeWorkEngineClientId,
} from '../../src/domains/income/income-work-engine-bridge.pure.js';

test('income document period key from ISO date', () => {
  assert.equal(incomeDocumentPeriodKey('2026-05-10'), '2026-05');
});

test('office mode uses represented_client_id as Work Engine client_id', () => {
  const clientId = 'a1111111-1111-4111-8111-111111111111';
  assert.equal(resolveIncomeWorkEngineClientId(clientId), clientId);
  assert.equal(resolveIncomeWorkEngineClientId(null), null);
});

test('overdue compares due_date only (no amount/debt math)', () => {
  assert.equal(isOverdueByDueDate('2026-05-10', '2026-05-11'), true);
  assert.equal(isOverdueByDueDate('2026-05-11', '2026-05-11'), false);
});

test('amount_reference reads display snapshot fields only', () => {
  assert.equal(
    amountReferenceFromTotalsSnapshot({ amount_reference: 1200 }),
    1200,
  );
  assert.equal(amountReferenceFromTotalsSnapshot(null), null);
});

test('deferred payment events documented', () => {
  assert.ok(INCOME_WORK_EVENTS_DEFERRED.includes('income.invoice_paid'));
  assert.equal(INCOME_WORK_EVENT_DOCUMENT_ISSUED, 'income.document_issued');
  assert.equal(INCOME_WORK_EVENT_DUE_DATE_SET, 'income.invoice_due_date_set');
  assert.equal(INCOME_WORK_EVENT_OVERDUE, 'income.invoice_overdue');
  assert.equal(INCOME_WORK_EVENT_DOCUMENT_SENT_BY_EMAIL, 'income.document_sent_by_email');
});
