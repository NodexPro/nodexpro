import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildIncomeIssuedDocumentPrintSrcDoc,
} from '../src/components/income/income-issued-document-print.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));

test('issued document print uses parent-controlled canonical HTML, not sandboxed iframe.print', () => {
  const modal = readFileSync(
    join(dir, '../src/components/income/IncomeIssuedDocumentViewModal.tsx'),
    'utf8',
  );
  const printHelper = readFileSync(
    join(dir, '../src/components/income/income-issued-document-print.pure.ts'),
    'utf8',
  );
  const previewPaper = readFileSync(
    join(dir, '../src/components/work-engine/WorkEngineIncomeDocumentPreviewPaper.tsx'),
    'utf8',
  );
  assert.match(modal, /printIncomeIssuedDocumentHtml\(previewHtml\)/);
  assert.doesNotMatch(modal, /contentWindow\?\.print/);
  assert.match(printHelper, /buildIncomeIssuedDocumentPrintSrcDoc/);
  assert.match(printHelper, /\.print\(\)/);
  assert.doesNotMatch(printHelper, /window\.open/);
  assert.doesNotMatch(printHelper, /buildIncomePreviewScreenIframeSrcDoc/);
  assert.doesNotMatch(printHelper, /printWindow\.close/);
  assert.match(printHelper, /afterprint/);
  assert.match(printHelper, /cleanup/);
  assert.match(previewPaper, /sandbox="allow-same-origin"/);
  assert.doesNotMatch(previewPaper, /allow-scripts/);
});

test('print srcdoc wraps canonical HTML with A4 @page and 48px margins, scale 1', () => {
  const canonical = '<div class="nx-doc nx-doc--sectioned">INVOICE_BODY</div>';
  const srcDoc = buildIncomeIssuedDocumentPrintSrcDoc(canonical);
  assert.match(srcDoc, /INVOICE_BODY/);
  assert.match(srcDoc, /@page \{ size: A4 portrait; margin: 48px; \}/);
  assert.doesNotMatch(srcDoc, /794px/);
  assert.doesNotMatch(srcDoc, /1123px/);
  assert.doesNotMatch(srcDoc, /transform\s*:\s*scale/);
  assert.doesNotMatch(srcDoc, /min-height:\s*297mm/);
  assert.doesNotMatch(srcDoc, /fonts\.googleapis/);
  assert.doesNotMatch(srcDoc, /@import/);
  assert.match(srcDoc, /print-color-adjust:\s*exact/);
});

test('issued toolbar email/docflow icons follow backend action.enabled and reuse existing send modals', () => {
  const modal = readFileSync(
    join(dir, '../src/components/income/IncomeIssuedDocumentViewModal.tsx'),
    'utf8',
  );
  assert.match(modal, /email_delivery\?\.action/);
  assert.match(modal, /docflow_delivery\?\.action/);
  assert.match(modal, /emailAction\?\.enabled/);
  assert.match(modal, /docflowAction\?\.enabled/);
  assert.match(modal, /income-issued-document-email/);
  assert.match(modal, /income-issued-document-docflow/);
  assert.match(modal, /IncomeDocumentEmailHistoryModal/);
  assert.match(modal, /IncomeDocumentDocflowSendModal/);
  assert.doesNotMatch(modal, /פתיחת PDF/);
  assert.doesNotMatch(modal, /nx-we-retainer-preview-modal__toolbar/);
});
