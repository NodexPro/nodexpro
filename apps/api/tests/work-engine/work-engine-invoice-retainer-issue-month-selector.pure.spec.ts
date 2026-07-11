import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAllowedIssueMonthKeys,
  buildIssueMonthSelector,
  resolveDefaultIssueMonth,
  resolveIssueDateForIssueMonth,
} from '../../src/domains/work-engine/work-engine-invoice-retainer-issue-month-selector.pure.js';
import { assertIssueMonthAllowed } from '../../src/domains/work-engine/work-engine-invoice-retainer-issue-month-selector.pure.js';

test('buildAllowedIssueMonthKeys allows one month back and three months ahead', () => {
  const keys = buildAllowedIssueMonthKeys({ todayIso: '2026-07-08' });
  assert.deepEqual(keys, ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
});

test('buildIssueMonthSelector defaults to document month when allowed', () => {
  const selector = buildIssueMonthSelector({
    todayIso: '2026-07-08',
    documentDate: '2026-08-15',
    mode: 'issue',
  });
  assert.equal(selector.default_month, '2026-08');
  assert.equal(selector.selected_month, '2026-08');
  assert.equal(selector.allowed_months.length, 5);
  assert.match(
    selector.allowed_months.find((month) => month.month_key === '2026-08')?.confirmation_message ?? '',
    /אוגוסט 2026/,
  );
});

test('resolveIssueDateForIssueMonth preserves draft day within selected month', () => {
  assert.equal(resolveIssueDateForIssueMonth('2026-07', '2026-08-15'), '2026-07-15');
});

test('assertIssueMonthAllowed rejects months outside backend window', () => {
  assert.throws(
    () => assertIssueMonthAllowed({ todayIso: '2026-07-08', issueMonth: '2026-05' }),
    /outside the allowed accounting month window/,
  );
});

test('resolved Country Pack window overrides the fallback in selector and validation', () => {
  const selector = buildIssueMonthSelector({
    todayIso: '2026-07-08',
    documentDate: null,
    mode: 'issue',
    monthsBack: 2,
    monthsAhead: 1,
  });
  assert.deepEqual(
    selector.allowed_months.map((month) => month.month_key),
    ['2026-05', '2026-06', '2026-07', '2026-08'],
  );
  assert.doesNotThrow(() =>
    assertIssueMonthAllowed({
      todayIso: '2026-07-08',
      issueMonth: '2026-05',
      monthsBack: 2,
      monthsAhead: 1,
    }),
  );
  assert.throws(() =>
    assertIssueMonthAllowed({
      todayIso: '2026-07-08',
      issueMonth: '2026-09',
      monthsBack: 2,
      monthsAhead: 1,
    }),
  );
});

test('resolveIssueDateForIssueMonth clamps invalid day-of-month to last day', () => {
  assert.equal(resolveIssueDateForIssueMonth('2026-02', '2026-01-31'), '2026-02-28');
  assert.equal(resolveIssueDateForIssueMonth('2026-04', '2026-05-31'), '2026-04-30');
  assert.equal(resolveIssueDateForIssueMonth('2026-04', null), '2026-04-01');
});

test('resolveDefaultIssueMonth falls back to current month when document month is outside window', () => {
  assert.equal(
    resolveDefaultIssueMonth({
      todayIso: '2026-07-08',
      documentDate: '2026-12-01',
      allowedMonthKeys: buildAllowedIssueMonthKeys({ todayIso: '2026-07-08' }),
    }),
    '2026-07',
  );
});
