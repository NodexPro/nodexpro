/**
 * P0 — Issued VIEW (HTML) is independent of PDF binary generation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  buildIncomeIssuedDocumentPdfAction,
  buildIncomeIssuedDocumentViewAction,
} from '../../src/domains/income/income-document-view-action.pure.js';
import { resolveIncomeDocumentEmailSendEligibility } from '../../src/domains/income/income-document-email-delivery.read-model.pure.js';
import {
  buildUnifiedIncomeDocumentPrintHtml,
  renderUnifiedIncomeDocumentHtml,
} from '../../src/domains/income/income-document-unified-render.html.js';

const dir = dirname(fileURLToPath(import.meta.url));
const viewServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-issued-document-view.service.ts'),
  'utf8',
);
const pdfServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-pdf.service.ts'),
  'utf8',
);
const routesSource = readFileSync(join(dir, '../../src/domains/income/income.routes.ts'), 'utf8');
const weModalSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineClientDocumentsByTypeModal.tsx'),
  'utf8',
);
const issuedModalSource = readFileSync(
  join(dir, '../../../web/src/components/income/IncomeIssuedDocumentViewModal.tsx'),
  'utf8',
);
const apiPackageJson = readFileSync(join(dir, '../../package.json'), 'utf8');

const docId = randomUUID();

test('A/B view_action enabled even when PDF failed; pdf_action disabled', () => {
  const view = buildIncomeIssuedDocumentViewAction({
    incomeDocumentId: docId,
    canView: true,
  });
  assert.equal(view.enabled, true);
  assert.equal(view.view_mode, 'issued_html');
  assert.equal(view.view_aggregate_key, 'income_issued_document_view_aggregate');

  const pdfFailed = buildIncomeIssuedDocumentPdfAction({
    incomeDocumentId: docId,
    canRetryPdf: true,
    pdfRenderStatus: 'failed',
    pdfAssetId: null,
    pdfDownloadPath: null,
    pdfRenderError: 'pdf_engine: Unified PDF render unavailable',
  });
  assert.equal(pdfFailed.enabled, false);
  assert.equal(pdfFailed.retry_command, 'retry_income_document_pdf_render');
  assert.match(String(pdfFailed.disabled_reason), /pdf_engine/);
});

test('A rendered PDF enables download action', () => {
  const path = `/api/v1/income/documents/${docId}/download`;
  const pdf = buildIncomeIssuedDocumentPdfAction({
    incomeDocumentId: docId,
    canRetryPdf: true,
    pdfRenderStatus: 'rendered',
    pdfAssetId: randomUUID(),
    pdfDownloadPath: path,
  });
  assert.equal(pdf.enabled, true);
  assert.equal(pdf.pdf_download_path, path);
  assert.equal(pdf.retry_command, null);
});

test('C pending PDF — view still enabled; pdf preparing', () => {
  const view = buildIncomeIssuedDocumentViewAction({ incomeDocumentId: docId, canView: true });
  assert.equal(view.enabled, true);
  const pdf = buildIncomeIssuedDocumentPdfAction({
    incomeDocumentId: docId,
    canRetryPdf: true,
    pdfRenderStatus: 'pending',
    pdfAssetId: null,
    pdfDownloadPath: null,
  });
  assert.equal(pdf.enabled, false);
  assert.equal(pdf.pdf_status_key, 'pdf_pending');
  assert.equal(pdf.retry_command, null);
});

test('D/E/F issued view aggregate uses unified issued renderer; no draft/edit', () => {
  assert.match(viewServiceSource, /buildUnifiedIncomeDocumentRenderModelForIssuedDocument/);
  assert.match(viewServiceSource, /renderUnifiedIncomeDocumentHtml/);
  assert.match(viewServiceSource, /document_status !== 'issued'/);
  assert.match(viewServiceSource, /resolveIssuerScopeForIssuedDocumentView/);
  assert.doesNotMatch(viewServiceSource, /resume_income_document_draft/);
  assert.doesNotMatch(viewServiceSource, /buildIncomeDocumentDetailsStep/);
  assert.match(pdfServiceSource, /buildUnifiedIncomeDocumentRenderModelForIssuedDocument/);
  assert.match(pdfServiceSource, /buildUnifiedIncomeDocumentPrintHtml/);
  assert.match(routesSource, /issued-document-view/);
});

test('F viewer HTML body is the same function PDF wraps for print', () => {
  // Prove shared contract: print HTML = wrap(body HTML).
  assert.match(
    readFileSync(join(dir, '../../src/domains/income/income-document-unified-render.html.ts'), 'utf8'),
    /wrapUnifiedIncomeDocumentHtmlForPrint\(renderUnifiedIncomeDocumentHtml/,
  );
  assert.equal(typeof renderUnifiedIncomeDocumentHtml, 'function');
  assert.equal(typeof buildUnifiedIncomeDocumentPrintHtml, 'function');
});

test('G email remains blocked when PDF failed', () => {
  const email = resolveIncomeDocumentEmailSendEligibility({
    permissions: { view: true, edit: true, issue: true, issue_on_behalf: true },
    representedClientId: randomUUID(),
    documentStatus: 'issued',
    pdfRenderStatus: 'failed',
    pdfAssetId: null,
  });
  assert.equal(email.enabled, false);
  assert.equal(email.disabled_reason_key, 'pdf_failed');
});

test('H/I FE opens issued HTML viewer; no draft fallback; no PDF required for number click', () => {
  assert.match(weModalSource, /IncomeIssuedDocumentViewModal/);
  assert.match(weModalSource, /setIssuedViewDocId/);
  assert.match(weModalSource, /representedClientId=\{params\.representedClientId\}/);
  assert.doesNotMatch(weModalSource, /openIncomeDocumentPdf/);
  assert.doesNotMatch(issuedModalSource, /resume_income_document_draft/);
  assert.doesNotMatch(issuedModalSource, /IncomeDocumentWizardModal/);
  assert.doesNotMatch(issuedModalSource, /nx-accounting-editor-modal/);
  assert.doesNotMatch(issuedModalSource, /nx-income-wizard/);
  assert.match(issuedModalSource, /nx-we-retainer-preview-overlay/);
  assert.match(issuedModalSource, /createPortal/);
  assert.match(issuedModalSource, /document_html/);
  assert.match(issuedModalSource, /pdf_action/);
  assert.match(issuedModalSource, /retry_command/);
});

test('J no duplicate renderer — reuses unified HTML path', () => {
  assert.match(viewServiceSource, /income-document-unified-render/);
  assert.doesNotMatch(viewServiceSource, /createElement|jsx|react/i);
});

test('infra: puppeteer dependency + postinstall chrome ensure script', () => {
  assert.match(apiPackageJson, /"puppeteer"/);
  assert.match(apiPackageJson, /ensure-puppeteer-chrome/);
});
