import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
  assert.match(printHelper, /buildIncomePreviewScreenIframeSrcDoc/);
  assert.match(printHelper, /window\.open/);
  assert.match(printHelper, /\.print\(\)/);
  assert.match(previewPaper, /sandbox="allow-same-origin"/);
  assert.doesNotMatch(previewPaper, /allow-scripts/);
});
