import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../../src/shared/errors.js';
import {
  assertRetainerTemplateDocumentDateNotBeforeToday,
  coerceRetainerTemplateDocumentDate,
  isDocumentDateBeforeToday,
  RETAINER_TEMPLATE_DOCUMENT_DATE_BEFORE_TODAY_ERROR,
  todayIsoDate,
} from '../../src/domains/income/income-retainer-template-document-date.pure.js';

test('coerceRetainerTemplateDocumentDate bumps past dates to today', () => {
  assert.equal(coerceRetainerTemplateDocumentDate('2026-06-23', '2026-06-26'), '2026-06-26');
  assert.equal(coerceRetainerTemplateDocumentDate('2026-06-26', '2026-06-26'), '2026-06-26');
  assert.equal(coerceRetainerTemplateDocumentDate('2026-07-01', '2026-06-26'), '2026-07-01');
  assert.equal(coerceRetainerTemplateDocumentDate(null, '2026-06-26'), '2026-06-26');
});

test('assertRetainerTemplateDocumentDateNotBeforeToday rejects backdated dates', () => {
  assert.throws(
    () => assertRetainerTemplateDocumentDateNotBeforeToday('2026-06-23', '2026-06-26'),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.message, RETAINER_TEMPLATE_DOCUMENT_DATE_BEFORE_TODAY_ERROR);
      assert.equal(err.code, 'retainer_template_document_date_before_today');
      return true;
    },
  );
});

test('retainer template document date error message is Hebrew', () => {
  assert.match(RETAINER_TEMPLATE_DOCUMENT_DATE_BEFORE_TODAY_ERROR, /לא ניתן לבחור תאריך מסמך מוקדם מהיום/);
});

test('isDocumentDateBeforeToday compares ISO dates', () => {
  assert.equal(isDocumentDateBeforeToday('2026-06-23', '2026-06-26'), true);
  assert.equal(isDocumentDateBeforeToday('2026-06-26', '2026-06-26'), false);
});

test('todayIsoDate returns YYYY-MM-DD', () => {
  assert.match(todayIsoDate(new Date('2026-06-26T12:00:00.000Z')), /^\d{4}-\d{2}-\d{2}$/);
});
