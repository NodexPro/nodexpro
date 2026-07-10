import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAccountingPostingFailedRow,
  buildDeliveryFailedRow,
  buildFailedOperationsSummary,
  buildIncomePdfFailedRow,
  buildWorkEventFailedRow,
  formatFailedOperationOccurredLabel,
  resolveFailedOperationsCardTone,
  resolveFailedOperationsSeverityLabel,
} from '../../src/domains/work-engine/work-engine-failed-operations.pure.js';

test('failed operations total_count sums source counts only', () => {
  const summary = buildFailedOperationsSummary({
    deliveryFailedCount: 2,
    incomePdfFailedCount: 1,
    workEventFailedCount: 0,
    retainerFailedCount: 0,
    accountingPostingFailedCount: 0,
    rows: [],
  });
  assert.equal(summary.total_count, 3);
  assert.equal(summary.sources[0]?.count, 2);
  assert.equal(summary.sources[1]?.count, 1);
  assert.equal(summary.sources[2]?.count, 0);
});

test('failed operations card uses Errors label and is clickable when count > 0', () => {
  const row = buildDeliveryFailedRow({
    id: 'd1',
    client_id: 'c1',
    client_label: 'Acme',
    source_module: 'income',
    channel: 'email',
    failure_reason: 'SMTP rejected',
    source_entity_type: 'income_document',
    source_entity_id: 'doc-1',
    occurred_at: '2026-07-07T10:00:00.000Z',
  });
  const summary = buildFailedOperationsSummary({
    deliveryFailedCount: 1,
    incomePdfFailedCount: 0,
    workEventFailedCount: 0,
    retainerFailedCount: 0,
    accountingPostingFailedCount: 0,
    rows: [row],
  });
  assert.equal(summary.card.key, 'errors');
  assert.equal(summary.card.label, 'Errors');
  assert.equal(summary.card.count, 1);
  assert.equal(summary.card.tone, 'danger');
  assert.equal(summary.card.clickable, true);
  assert.equal(summary.card.modal_key, 'failed_operations');
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.rows[0]?.client_label, 'Acme');
  assert.equal(summary.rows[0]?.module_label, 'Income');
  assert.equal(summary.rows[0]?.error_label, 'SMTP rejected');
  assert.match(summary.rows[0]?.how_to_fix ?? '', /recipient email/i);
  assert.equal(summary.rows[0]?.occurred_at_label, formatFailedOperationOccurredLabel('2026-07-07T10:00:00.000Z'));
});

test('failed operations card is neutral and not clickable when there are no errors', () => {
  const summary = buildFailedOperationsSummary({
    deliveryFailedCount: 0,
    incomePdfFailedCount: 0,
    workEventFailedCount: 0,
    retainerFailedCount: 0,
    accountingPostingFailedCount: 0,
    rows: [],
  });
  assert.equal(resolveFailedOperationsCardTone(0), 'neutral');
  assert.equal(resolveFailedOperationsSeverityLabel(0), 'No operational errors');
  assert.equal(summary.card.tone, 'neutral');
  assert.equal(summary.card.clickable, false);
  assert.equal(summary.total_count, 0);
});

test('PDF failed row uses backend how_to_fix dictionary', () => {
  const row = buildIncomePdfFailedRow({
    id: 'doc-1',
    client_id: 'c1',
    client_label: 'Beta',
    document_type: 'invoice',
    document_number: '1001',
    occurred_at: '2026-07-07T11:00:00.000Z',
  });
  assert.equal(row.error_label, 'PDF render failed');
  assert.equal(row.how_to_fix, 'Open the document and retry PDF render.');
  assert.equal(row.module_label, 'Income');
});

test('work event failed row uses backend labels', () => {
  const row = buildWorkEventFailedRow({
    id: 'evt-1',
    client_id: null,
    client_label: '—',
    source_module: 'work_engine',
    event_type: 'recurring_generation_failed',
    processing_error: 'mapping error',
    occurred_at: '2026-07-07T12:00:00.000Z',
  });
  assert.equal(row.error_label, 'mapping error');
  assert.equal(row.how_to_fix, 'Review event payload and source module.');
});

test('accounting posting failed row is backend-prepared', () => {
  const row = buildAccountingPostingFailedRow({
    id: 'doc-2',
    client_id: 'c2',
    client_label: 'Gamma',
    document_type: 'invoice',
    document_number: '42',
    occurred_at: '2026-07-07T13:00:00.000Z',
  });
  assert.equal(row.error_label, 'Accounting posting failed');
  assert.equal(row.how_to_fix, 'Open the document and retry accounting posting.');
});
