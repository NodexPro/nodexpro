import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleAmountFromDraftTotalsPreview } from '../../src/domains/work-engine/work-engine-invoice-retainer-schedule-draft-amount.pure.js';

test('scheduleAmountFromDraftTotalsPreview uses backend grand_total_display and reference', () => {
  const amount = scheduleAmountFromDraftTotalsPreview({
    grand_total_display: '₪1,416.00',
    grand_total_reference: 1416,
  });
  assert.deepEqual(amount, {
    amount_display: '₪1,416.00',
    grand_total_reference: 1416,
  });
});

test('scheduleAmountFromDraftTotalsPreview parses display when reference missing', () => {
  const amount = scheduleAmountFromDraftTotalsPreview({
    grand_total_display: '₪1,180.00',
  });
  assert.equal(amount?.amount_display, '₪1,180.00');
  assert.equal(amount?.grand_total_reference, 1180);
});

test('scheduleAmountFromDraftTotalsPreview returns null for invalid preview', () => {
  assert.equal(scheduleAmountFromDraftTotalsPreview(null), null);
  assert.equal(scheduleAmountFromDraftTotalsPreview({}), null);
});
