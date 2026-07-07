/**
 * P11.4 — Failed operations KPI / queue aggregate contract gates.
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
const queuePageSource = readFileSync(
  join(dir, '../../../web/src/pages/WorkEngineQueue.tsx'),
  'utf8',
);

test('queue aggregate includes failed_operations_summary and summary_cards.errors', () => {
  assert.match(readModelsSource, /loadFailedOperationsSummary\(orgId\)/);
  assert.match(readModelsSource, /failed_operations_summary:\s*failedOperationsSummary/);
  assert.match(readModelsSource, /errors:\s*failedOperationsSummary\.total_count/);
  assert.match(readModelsSource, /attention_cards:\s*\[invoiceAttentionCard,\s*failedOperationsSummary\.card\]/);
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

test('frontend queue page does not calculate Errors count locally', () => {
  assert.match(queuePageSource, /attentionCards=\{aggregate\.attention_cards/);
  assert.doesNotMatch(queuePageSource, /failed_operations_summary/);
});

test('errors KPI card is backend-provided via attention_cards render path', () => {
  assert.match(queuePageSource, /attentionCards\.map\(renderAttentionCard\)/);
  assert.match(queuePageSource, /card\.count/);
  assert.match(queuePageSource, /card\.label/);
});
