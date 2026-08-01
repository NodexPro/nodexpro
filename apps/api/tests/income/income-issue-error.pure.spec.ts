import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEBREW_ISSUER_SCOPE_MISMATCH,
  mapIncomeIssueUserFacingMessage,
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
