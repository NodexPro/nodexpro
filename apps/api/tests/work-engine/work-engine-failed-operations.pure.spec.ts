import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFailedOperationsSummary,
  resolveFailedOperationsCardTone,
  resolveFailedOperationsSeverityLabel,
} from '../../src/domains/work-engine/work-engine-failed-operations.pure.js';

test('failed operations total_count sums source counts only', () => {
  const summary = buildFailedOperationsSummary({
    deliveryFailedCount: 2,
    incomePdfFailedCount: 1,
    workEventFailedCount: 0,
    lastSeenAt: '2026-07-07T10:00:00.000Z',
  });
  assert.equal(summary.total_count, 3);
  assert.equal(summary.sources[0]?.count, 2);
  assert.equal(summary.sources[1]?.count, 1);
  assert.equal(summary.sources[2]?.count, 0);
});

test('failed operations card uses Errors label and danger tone when count > 0', () => {
  const summary = buildFailedOperationsSummary({
    deliveryFailedCount: 1,
    incomePdfFailedCount: 0,
    workEventFailedCount: 0,
    lastSeenAt: null,
  });
  assert.equal(summary.card.key, 'errors');
  assert.equal(summary.card.label, 'Errors');
  assert.equal(summary.card.count, 1);
  assert.equal(summary.card.tone, 'danger');
  assert.equal(summary.card.clickable, false);
});

test('failed operations card is neutral when there are no errors', () => {
  const summary = buildFailedOperationsSummary({
    deliveryFailedCount: 0,
    incomePdfFailedCount: 0,
    workEventFailedCount: 0,
    lastSeenAt: null,
  });
  assert.equal(resolveFailedOperationsCardTone(0), 'neutral');
  assert.equal(resolveFailedOperationsSeverityLabel(0), 'No operational errors');
  assert.equal(summary.card.tone, 'neutral');
  assert.equal(summary.total_count, 0);
});

test('successful-only sources contribute zero without affecting total', () => {
  const summary = buildFailedOperationsSummary({
    deliveryFailedCount: 0,
    incomePdfFailedCount: 0,
    workEventFailedCount: 0,
    lastSeenAt: null,
  });
  assert.equal(summary.total_count, 0);
  assert.equal(summary.sources.every((s) => s.count === 0), true);
});
