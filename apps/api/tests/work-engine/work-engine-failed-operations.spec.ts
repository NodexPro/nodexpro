/**
 * P11.4 / P11.7 — Failed operations KPI + errors inbox contract gates.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const readModelsSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine.read-models.service.ts'),
  'utf8',
);
const failedOpsReadSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-failed-operations.read.ts'),
  'utf8',
);
const failedOpsPureSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-failed-operations.pure.ts'),
  'utf8',
);
const queuePageSource = readFileSync(
  join(dir, '../../../web/src/pages/WorkEngineQueue.tsx'),
  'utf8',
);

test('queue aggregate includes failed_operations_summary.rows and summary_cards.errors', () => {
  assert.match(readModelsSource, /loadFailedOperationsSummary\(orgId\)/);
  assert.match(readModelsSource, /failed_operations_summary:\s*failedOperationsSummary/);
  assert.match(readModelsSource, /errors:\s*failedOperationsSummary\.total_count/);
  assert.match(readModelsSource, /attention_cards:\s*\[invoiceAttentionCard,\s*failedOperationsSummary\.card\]/);
  assert.match(failedOpsPureSource, /rows:\s*mergedRows/);
});

test('delivery_attempts failed rows are counted with org scope', () => {
  assert.match(failedOpsReadSource, /from\('delivery_attempts'\)/);
  assert.match(failedOpsReadSource, /\.eq\('organization_id',\s*orgId\)/);
  assert.match(failedOpsReadSource, /\.eq\('result',\s*'failed'\)/);
});

test('successful delivery_attempts are excluded from failed count', () => {
  assert.doesNotMatch(failedOpsReadSource, /\.eq\('result',\s*'sent'\)/);
  assert.doesNotMatch(failedOpsReadSource, /\.eq\('result',\s*'pending'\)/);
});

test('income pdf_render_status failed and work_events processing_status failed are org-scoped', () => {
  assert.match(failedOpsReadSource, /from\('income_documents'\)/);
  assert.match(failedOpsReadSource, /\.eq\('pdf_render_status',\s*'failed'\)/);
  assert.match(failedOpsReadSource, /from\('work_events'\)/);
  assert.match(failedOpsReadSource, /\.eq\('processing_status',\s*'failed'\)/);
});

test('retainer and accounting posting failures use persisted org-scoped sources', () => {
  assert.match(failedOpsReadSource, /from\('income_recurring_document_cycles'\)/);
  assert.match(failedOpsReadSource, /\.eq\('status',\s*'failed'\)/);
  assert.match(failedOpsReadSource, /\.eq\('accounting_posting_status',\s*'failed'\)/);
});

test('failed operations card is clickable via backend card descriptor', () => {
  assert.match(failedOpsPureSource, /clickable:\s*total_count > 0/);
  assert.match(failedOpsPureSource, /modal_key:\s*'failed_operations'/);
});

test('backend prepares Client / Module / Error / How to fix / Date labels on rows', () => {
  assert.match(failedOpsPureSource, /client_label/);
  assert.match(failedOpsPureSource, /module_label/);
  assert.match(failedOpsPureSource, /error_label/);
  assert.match(failedOpsPureSource, /how_to_fix/);
  assert.match(failedOpsPureSource, /occurred_at_label/);
  assert.match(failedOpsPureSource, /formatFailedOperationOccurredLabel/);
});

test('payment match failures noted as not included yet', () => {
  assert.match(failedOpsPureSource, /Payment match failures: not included yet/);
  assert.match(failedOpsPureSource, /notes:/);
});

test('no Owner Panel diagnostics included in failed operations module', () => {
  assert.doesNotMatch(failedOpsReadSource, /owner-system-health/);
  assert.doesNotMatch(failedOpsReadSource, /owner_clients/);
  assert.doesNotMatch(failedOpsPureSource, /customer_health/);
});

test('frontend queue page does not calculate Errors count locally', () => {
  assert.match(queuePageSource, /attentionCards=\{aggregate\.attention_cards/);
  assert.doesNotMatch(queuePageSource, /failed_operations_summary\.total_count/);
});

test('P11.7 UI: clicking Errors card opens modal from queue aggregate', () => {
  assert.match(queuePageSource, /modal_key === 'failed_operations'/);
  assert.match(queuePageSource, /onOpenFailedOperationsModal/);
  assert.match(queuePageSource, /failedOperationsModalOpen/);
  assert.match(queuePageSource, /FailedOperationsModal/);
});

test('P11.7 UI: modal renders rows from queue aggregate only', () => {
  assert.match(queuePageSource, /failed_operations_summary/);
  assert.match(queuePageSource, /summary\?\.rows/);
  assert.doesNotMatch(queuePageSource, /fetchWorkEngine.*[Ee]rror/);
  assert.doesNotMatch(queuePageSource, /\/errors/);
});

test('P11.7 UI: modal columns include Client, Module, Error, How to fix, Date', () => {
  assert.match(queuePageSource, /row\.client_label/);
  assert.match(queuePageSource, /row\.module_label/);
  assert.match(queuePageSource, /row\.error_label/);
  assert.match(queuePageSource, /row\.how_to_fix/);
  assert.match(queuePageSource, /row\.occurred_at_label/);
});

test('P11.7 UI: empty state and descriptor-only actions', () => {
  assert.match(queuePageSource, /No operational errors detected/);
  assert.match(queuePageSource, /available_actions\.map/);
  assert.match(queuePageSource, /disabled=\{!action\.enabled\}/);
  const start = queuePageSource.indexOf('function FailedOperationsModal');
  const end = queuePageSource.indexOf('function FiltersBar', start);
  const modalSource = queuePageSource.slice(start, end);
  assert.ok(modalSource.length > 0);
  assert.doesNotMatch(modalSource, /executeWorkEngineQueueCommand/);
});

test('P11.7 UI: no local filtering or counting of failed operations rows', () => {
  const start = queuePageSource.indexOf('function FailedOperationsModal');
  const end = queuePageSource.indexOf('function FiltersBar', start);
  const modalSource = queuePageSource.slice(start, end);
  assert.ok(modalSource.length > 0);
  assert.doesNotMatch(modalSource, /\.filter\(/);
  assert.doesNotMatch(modalSource, /\.reduce\(/);
  assert.match(modalSource, /summary\?\.rows/);
});
