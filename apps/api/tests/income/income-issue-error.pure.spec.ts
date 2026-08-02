import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEBREW_ISSUER_SCOPE_MISMATCH,
  HEBREW_ISSUE_GENERIC,
  extractIncomeIssueThrownMessage,
  mapIncomeIssueFailingStageMessage,
  mapIncomeIssueUserFacingMessage,
  resolveIncomeIssueUserFacingMessage,
} from '../../src/domains/income/income-issue-error.pure.js';

test('maps English issuer-scope errors to Hebrew for accountants', () => {
  assert.equal(
    mapIncomeIssueUserFacingMessage('Resource is outside active issuer scope'),
    HEBREW_ISSUER_SCOPE_MISMATCH,
  );
  assert.equal(
    mapIncomeIssueUserFacingMessage('Resource is outside active represented client scope'),
    HEBREW_ISSUER_SCOPE_MISMATCH,
  );
});

test('leaves non-scope messages unchanged for caller wrapping', () => {
  assert.equal(mapIncomeIssueUserFacingMessage('income.issue required'), null);
  assert.equal(mapIncomeIssueUserFacingMessage(null), null);
});

test('maps failing stages to Hebrew', () => {
  assert.match(String(mapIncomeIssueFailingStageMessage('numbering')), /מספר מסמך/);
  assert.match(String(mapIncomeIssueFailingStageMessage('accounting_posting')), /חשבונאות/);
  assert.equal(mapIncomeIssueFailingStageMessage('unknown_stage'), null);
});

test('resolve prefers issuer Hebrew and appends failing_stage tag', () => {
  const msg = resolveIncomeIssueUserFacingMessage({
    message: 'Resource is outside active issuer scope',
    failingStage: 'draft_load',
  });
  assert.equal(msg, `${HEBREW_ISSUER_SCOPE_MISMATCH} [draft_load]`);
});

test('resolve keeps existing Hebrew and appends stage', () => {
  const hebrew = 'לא ניתן להפיק מסמך בתאריך מוקדם ממסמך שכבר הונפק בסדרה זו.';
  const msg = resolveIncomeIssueUserFacingMessage({
    message: hebrew,
    failingStage: 'issue_command',
  });
  assert.equal(msg, `${hebrew} [issue_command]`);
});

test('resolve uses stage Hebrew for raw English/non-AppError', () => {
  const msg = resolveIncomeIssueUserFacingMessage({
    message: "Could not find the 'tax_allocation_number' column",
    failingStage: 'issued_document_insert',
  });
  assert.match(msg, /שמירת המסמך/);
  assert.match(msg, /\[issued_document_insert\]/);
});

test('resolve falls back to generic with stage tag', () => {
  const msg = resolveIncomeIssueUserFacingMessage({
    message: 'weird failure',
    failingStage: 'issue_command',
  });
  assert.equal(msg, `${HEBREW_ISSUE_GENERIC} [issue_command]`);
});

test('extractIncomeIssueThrownMessage reads plain Postgrest-like objects', () => {
  assert.equal(
    extractIncomeIssueThrownMessage({ message: 'column missing', code: 'PGRST204' }),
    'column missing',
  );
  assert.equal(extractIncomeIssueThrownMessage(new Error('boom')), 'boom');
});
