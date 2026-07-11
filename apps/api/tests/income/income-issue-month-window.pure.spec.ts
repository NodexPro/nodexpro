import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IL_ISSUE_MONTH_WINDOW_FALLBACK,
  issueMonthWindowFallbackResolution,
  parseIssueMonthWindowFromLegalPayload,
} from '../../src/domains/income/income-issue-month-window-fallback.pure.js';

test('IL fallback window is 1 back / 3 ahead and marked as fallback', () => {
  assert.equal(IL_ISSUE_MONTH_WINDOW_FALLBACK.months_back, 1);
  assert.equal(IL_ISSUE_MONTH_WINDOW_FALLBACK.months_ahead, 3);
  const resolution = issueMonthWindowFallbackResolution();
  assert.equal(resolution.source, 'fallback_il');
  assert.equal(resolution.legal_value_key, null);
});

test('parses valid Country Pack payload', () => {
  const parsed = parseIssueMonthWindowFromLegalPayload({ months_back: 2, months_ahead: 6 });
  assert.deepEqual(parsed, { months_back: 2, months_ahead: 6 });
});

test('rejects invalid Country Pack payloads', () => {
  assert.equal(parseIssueMonthWindowFromLegalPayload(null), null);
  assert.equal(parseIssueMonthWindowFromLegalPayload('1/3'), null);
  assert.equal(parseIssueMonthWindowFromLegalPayload({ months_back: -1, months_ahead: 3 }), null);
  assert.equal(parseIssueMonthWindowFromLegalPayload({ months_back: 1.5, months_ahead: 3 }), null);
  assert.equal(parseIssueMonthWindowFromLegalPayload({ months_back: 1, months_ahead: 99 }), null);
  assert.equal(parseIssueMonthWindowFromLegalPayload({ months_back: 1 }), null);
});
