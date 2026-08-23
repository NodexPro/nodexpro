/**
 * Draft document_preview toolbar — same download/print head icons as issued viewer.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIncomeDocumentPreviewToolbarActions } from '../../src/domains/income/income-document-preview-toolbar.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const detailsBuildersSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-details-step.builders.ts'),
  'utf8',
);
const futureCycleSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoice-retainer-future-cycle-projection.service.ts'),
  'utf8',
);
const retainerPreviewModalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineInvoiceRetainerPreviewModal.tsx'),
  'utf8',
);

test('preview toolbar: print enabled when ready; download disabled until issue', () => {
  const ready = buildIncomeDocumentPreviewToolbarActions({ previewReady: true });
  assert.equal(ready[0]?.action, 'preview_download');
  assert.equal(ready[0]?.enabled, false);
  assert.equal(ready[1]?.action, 'preview_print');
  assert.equal(ready[1]?.enabled, true);

  const notReady = buildIncomeDocumentPreviewToolbarActions({ previewReady: false });
  assert.equal(notReady[1]?.enabled, false);
});

test('draft details + future-cycle previews use shared toolbar helper', () => {
  assert.match(detailsBuildersSource, /buildIncomeDocumentPreviewToolbarActions/);
  assert.match(futureCycleSource, /buildIncomeDocumentPreviewToolbarActions/);
  const toolbarCall = detailsBuildersSource.slice(
    detailsBuildersSource.indexOf('toolbar_actions: buildIncomeDocumentPreviewToolbarActions'),
    detailsBuildersSource.indexOf('toolbar_actions: buildIncomeDocumentPreviewToolbarActions') + 220,
  );
  assert.doesNotMatch(toolbarCall, /conversion/i);
});

test('retainer preview modal renders download/print head icons from toolbar_actions', () => {
  assert.match(retainerPreviewModalSource, /preview_download/);
  assert.match(retainerPreviewModalSource, /preview_print/);
  assert.match(retainerPreviewModalSource, /we-document-preview-download/);
  assert.match(retainerPreviewModalSource, /we-document-preview-print/);
  assert.match(retainerPreviewModalSource, /printIncomeIssuedDocumentHtml/);
});
