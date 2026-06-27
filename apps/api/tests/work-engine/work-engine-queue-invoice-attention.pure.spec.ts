import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInvoiceAttentionCard,
  isInvoiceAttentionWorkType,
  resolveInvoiceAttentionCardTone,
} from '../../src/domains/work-engine/work-engine-queue-invoice-attention.pure.js';

test('invoice attention work types include retainer review and generation failure only', () => {
  assert.equal(isInvoiceAttentionWorkType('recurring_invoice_review'), true);
  assert.equal(isInvoiceAttentionWorkType('recurring_generation_failed'), true);
  assert.equal(isInvoiceAttentionWorkType('invoice_collection_followup'), false);
});

test('invoice attention card tone is neutral when count is zero', () => {
  assert.equal(resolveInvoiceAttentionCardTone({ totalCount: 0, failureCount: 0 }), 'neutral');
  const card = buildInvoiceAttentionCard({ totalCount: 0, failureCount: 0 });
  assert.equal(card.count, 0);
  assert.equal(card.label, 'Recurring');
  assert.equal(card.filter.queue_bucket, 'invoice_attention');
});

test('invoice attention card tone is danger when failures exist', () => {
  assert.equal(resolveInvoiceAttentionCardTone({ totalCount: 2, failureCount: 1 }), 'danger');
});

test('invoice attention card tone is warning when only review tasks exist', () => {
  assert.equal(resolveInvoiceAttentionCardTone({ totalCount: 3, failureCount: 0 }), 'warning');
});
