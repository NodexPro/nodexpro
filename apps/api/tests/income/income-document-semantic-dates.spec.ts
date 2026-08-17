import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  formatIncomeCalendarDateHe,
  formatIncomeDueDateDisplayHe,
  resolveIncomeDocumentSemanticDates,
} from '../../src/domains/income/income-document-semantic-dates.pure.js';
import { buildIncomeIssuedDocumentPdfAction } from '../../src/domains/income/income-document-view-action.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));

test('#4008 inverted stored pair maps to document date 30/07 and due date 19/09', () => {
  const mapped = resolveIncomeDocumentSemanticDates({
    issue_date: '2026-09-19',
    due_date: '2026-07-30',
  });
  assert.equal(mapped.document_date, '2026-07-30');
  assert.equal(mapped.due_date, '2026-09-19');
  assert.equal(formatIncomeCalendarDateHe(mapped.document_date), '30/07/2026');
  assert.equal(formatIncomeCalendarDateHe(mapped.due_date), '19/09/2026');
});

test('another tax invoice with chronological dates is not swapped', () => {
  const mapped = resolveIncomeDocumentSemanticDates({
    issue_date: '2026-08-01',
    due_date: '2026-08-31',
  });
  assert.equal(mapped.document_date, '2026-08-01');
  assert.equal(mapped.due_date, '2026-08-31');
  assert.equal(formatIncomeCalendarDateHe(mapped.document_date), '01/08/2026');
  assert.equal(formatIncomeCalendarDateHe(mapped.due_date), '31/08/2026');
});

test('calendar formatter does not use timezone Date parsing', () => {
  assert.equal(formatIncomeCalendarDateHe('2026-07-30'), '30/07/2026');
  assert.equal(formatIncomeCalendarDateHe('2026-07-30T21:00:00.000Z'), '30/07/2026');
  assert.equal(formatIncomeCalendarDateHe(null), '—');
});

test('issued render and documents-by-type read model use semantic dates', () => {
  const issuedView = readFileSync(
    join(dir, '../../src/domains/income/income-issued-document-view.service.ts'),
    'utf8',
  );
  const unifiedService = readFileSync(
    join(dir, '../../src/domains/income/income-document-unified-render.service.ts'),
    'utf8',
  );
  const documentsByType = readFileSync(
    join(
      dir,
      '../../src/domains/work-engine/work-engine-invoices-client-documents-by-type.read-model.service.ts',
    ),
    'utf8',
  );
  const pdfService = readFileSync(
    join(dir, '../../src/domains/income/income-document-pdf.service.ts'),
    'utf8',
  );
  assert.match(unifiedService, /resolveIncomeDocumentSemanticDates/);
  assert.match(unifiedService, /document_date: semanticDates\.document_date/);
  assert.match(unifiedService, /due_date: semanticDates\.due_date/);
  assert.doesNotMatch(issuedView, /due_date_row_before_document_date/);
  assert.match(documentsByType, /resolveIncomeDocumentSemanticDates/);
  assert.match(documentsByType, /issue_date_display: formatDateDisplay\(semanticDates\.document_date\)/);
  assert.match(documentsByType, /formatIncomeDueDateDisplayHe/);
  assert.match(documentsByType, /label: 'תאריך מסמך'/);
  assert.match(pdfService, /hasCanonicalIncomeDocumentPdfAsset\(doc\.pdf_asset_id\)/);
  assert.doesNotMatch(
    pdfService,
    /if \(doc\.pdf_render_status !== 'rendered' \|\| !doc\.pdf_asset_id\)/,
  );
});

test('PDF download action is enabled when an asset exists even if status is failed', () => {
  const pdf = buildIncomeIssuedDocumentPdfAction({
    incomeDocumentId: 'doc-1',
    canRetryPdf: true,
    pdfRenderStatus: 'failed',
    pdfAssetId: 'asset-1',
    pdfDownloadPath: null,
    pdfRenderError: 'stale',
  });
  assert.equal(pdf.enabled, true);
  assert.equal(pdf.pdf_download_path, '/api/v1/income/documents/doc-1/download');
  assert.equal(pdf.retry_command, null);
});

test('PDF download stays disabled when no asset exists', () => {
  const pdf = buildIncomeIssuedDocumentPdfAction({
    incomeDocumentId: 'doc-1',
    canRetryPdf: true,
    pdfRenderStatus: 'failed',
    pdfAssetId: null,
    pdfDownloadPath: null,
    pdfRenderError: 'pdf_engine failed',
  });
  assert.equal(pdf.enabled, false);
  assert.equal(pdf.pdf_download_path, null);
  assert.equal(pdf.retry_command, 'retry_income_document_pdf_render');
});

test('issued tax invoice due_date is exposed as תאריך לתשלום display', () => {
  assert.equal(
    formatIncomeDueDateDisplayHe({ issue_date: '2026-08-20', due_date: '2026-09-19' }),
    '19/09/2026',
  );
  assert.equal(
    formatIncomeDueDateDisplayHe({
      issue_date: '2026-09-19',
      due_date: '2026-07-30',
    }),
    '19/09/2026',
  );
});

test('paid invoice still exposes canonical due_date display', () => {
  assert.equal(
    formatIncomeDueDateDisplayHe({ issue_date: '2026-08-01', due_date: '2026-08-31' }),
    '31/08/2026',
  );
});

test('missing canonical due_date is not invented from issue_date or payment date', () => {
  assert.equal(
    formatIncomeDueDateDisplayHe({ issue_date: '2026-08-20', due_date: null }),
    null,
  );
});

test('documents-by-type due_date_display is independent of payment composition', () => {
  const documentsByType = readFileSync(
    join(
      dir,
      '../../src/domains/work-engine/work-engine-invoices-client-documents-by-type.read-model.service.ts',
    ),
    'utf8',
  );
  const mapStart = documentsByType.indexOf('return filtered.map');
  assert.ok(mapStart >= 0);
  const dueAssign = documentsByType.indexOf('formatIncomeDueDateDisplayHe', mapStart);
  const paymentBlock = documentsByType.indexOf('if (includePayment) {', mapStart);
  assert.ok(dueAssign > mapStart);
  assert.ok(paymentBlock > dueAssign);
  assert.doesNotMatch(
    documentsByType.slice(paymentBlock, paymentBlock + 900),
    /due_date_display\s*=/,
  );
});
