/**
 * P0 — Issued document usability: email prefill surface, PDF print HTML, view_action.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildIncomeDocumentEmailSendForm } from '../../src/domains/income/income-document-email-delivery.read-model.pure.js';
import { buildIncomeIssuedDocumentViewAction } from '../../src/domains/income/income-document-view-action.pure.js';
import { wrapUnifiedIncomeDocumentHtmlForPrint } from '../../src/domains/income/income-document-unified-render.html.js';
import { resolveIncomeDocumentEmailSendEligibility } from '../../src/domains/income/income-document-email-delivery.read-model.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const rendererSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-pdf.renderer.ts'),
  'utf8',
);
const historySource = readFileSync(
  join(dir, '../../src/domains/income/income-document-email-history.service.ts'),
  'utf8',
);
const issueSource = readFileSync(
  join(dir, '../../src/domains/income/income-document-issue.service.ts'),
  'utf8',
);
const emailModalSource = readFileSync(
  join(dir, '../../../web/src/components/income/IncomeDocumentEmailHistoryModal.tsx'),
  'utf8',
);
const incomeTableSource = readFileSync(
  join(dir, '../../../web/src/components/income/IncomeDocumentsTable.tsx'),
  'utf8',
);
const weDocsSource = readFileSync(
  join(dir, '../../../web/src/components/work-engine/WorkEngineClientDocumentsByTypeModal.tsx'),
  'utf8',
);

const officePerms = {
  view: true,
  edit: true,
  issue: true,
  issue_on_behalf: true,
};

test('email send form + aggregate root expose Core recipient default', () => {
  const form = buildIncomeDocumentEmailSendForm({
    incomeDocumentId: randomUUID(),
    sendEligibility: { enabled: true, disabled_reason: null, disabled_reason_key: null },
    recipientEmailDefault: 'core@client.example',
  });
  assert.equal(form.fields[0]?.default_value, 'core@client.example');
  assert.match(historySource, /recipient_email_default/);
  assert.match(historySource, /select\('id, display_name, email, is_archived'\)/);
});

test('web email modal binds recipient_email_default / field default_value without /clients', () => {
  assert.match(emailModalSource, /recipient_email_default/);
  assert.match(emailModalSource, /formValuesFromAggregate/);
  assert.doesNotMatch(emailModalSource, /\/clients/);
  assert.doesNotMatch(emailModalSource, /pdf_render_status\s*===/);
});

test('print HTML does not load Google Fonts CDN', () => {
  const html = wrapUnifiedIncomeDocumentHtmlForPrint('<div class="nx-doc">x</div>');
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
  assert.doesNotMatch(html, /@import url\(/);
});

test('puppeteer PDF path uses domcontentloaded not networkidle0', () => {
  assert.match(rendererSource, /waitUntil:\s*'domcontentloaded'/);
  assert.doesNotMatch(rendererSource, /networkidle0/);
});

test('PDF failed blocks send and exposes retry eligibility', () => {
  const elig = resolveIncomeDocumentEmailSendEligibility({
    permissions: officePerms,
    representedClientId: randomUUID(),
    documentStatus: 'issued',
    pdfRenderStatus: 'failed',
    pdfAssetId: null,
  });
  assert.equal(elig.enabled, false);
  assert.equal(elig.disabled_reason_key, 'pdf_failed');
  assert.equal(elig.retry_pdf_render_allowed, true);
});

test('view_action enabled only for rendered + asset', () => {
  const docId = randomUUID();
  const ready = buildIncomeIssuedDocumentViewAction({
    incomeDocumentId: docId,
    canView: true,
    canRetryPdf: true,
    pdfRenderStatus: 'rendered',
    pdfAssetId: randomUUID(),
    pdfDownloadPath: `/api/v1/income/documents/${docId}/download`,
  });
  assert.equal(ready.enabled, true);
  assert.equal(ready.action_key, 'open_document');
  assert.equal(ready.retry_command, null);
  assert.ok(ready.pdf_download_path);

  const failed = buildIncomeIssuedDocumentViewAction({
    incomeDocumentId: docId,
    canView: true,
    canRetryPdf: true,
    pdfRenderStatus: 'failed',
    pdfAssetId: null,
    pdfDownloadPath: null,
  });
  assert.equal(failed.enabled, false);
  assert.equal(failed.retry_command, 'retry_income_document_pdf_render');
  assert.match(String(failed.disabled_reason), /PDF|pdf|הפקה|זמין/i);
});

test('issued lists wire document_number click to view_action / openIncomeDocumentPdf', () => {
  assert.match(incomeTableSource, /view_action/);
  assert.match(incomeTableSource, /nx-income-doc-number-link/);
  assert.match(weDocsSource, /view_action/);
  assert.match(weDocsSource, /openIncomeDocumentPdf/);
  assert.match(weDocsSource, /retry_command/);
  assert.doesNotMatch(weDocsSource, /resume_income_document_draft.*document_number/);
});

test('issue path remains async PDF schedule (no sync render)', () => {
  assert.match(issueSource, /scheduleIncomeDocumentPdfRender/);
  assert.doesNotMatch(issueSource, /await\s+renderIncomeDocumentPdf\s*\(/);
});
