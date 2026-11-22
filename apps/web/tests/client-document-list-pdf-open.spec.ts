import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('opening the client document list dialog does not generate a PDF', () => {
  const tab = read('../src/components/ClientAnnualReportTab.tsx');
  const modal = read('../src/components/client-operations/ClientAnnualClientDocumentListModal.tsx');
  const openIdx = tab.indexOf('setPdfListOpen(true)');
  const generateIdx = tab.indexOf("runPdfListCommand('generate_client_document_list_pdf'");
  assert.ok(openIdx >= 0);
  assert.ok(generateIdx > openIdx);
  assert.match(modal, /onClick=\{\(\) => props\.onGenerate\(selectedIds\)\}/);
  assert.doesNotMatch(modal, /useEffect\([\s\S]*onGenerate/);
  assert.doesNotMatch(tab, /setPdfListOpen\(true\)[\s\S]{0,200}generate_client_document_list_pdf/);
});
