import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('income-tax deductions registry cell reuses the NI paperclip command', () => {
  const view = read('../src/components/client-operations/ClientOperationsRegistryView.tsx');
  assert.match(view, /filingTarget: 'income_tax_deductions'/);
  assert.match(view, /filing_target: niEvidencePrompt\.filingTarget/);
  assert.match(view, /col\.key === 'income_tax_deductions'/);
  assert.match(view, /nx-co-sheet__ni-clip/);
});

test('workspace sidebar exposes per-user Hebrew/English language selection', () => {
  const sidebar = read('../src/templates/template-1/components/SidebarAccountBlock.tsx');
  assert.match(sidebar, /data-testid="sidebar-language-selector"/);
  assert.match(sidebar, /onSetLanguage\(code\)/);
  assert.match(sidebar, /code !== 'en' && code !== 'he'/);
});

test('annual and capital tabs expose the client document list section', () => {
  const annual = read('../src/components/ClientAnnualReportTab.tsx');
  const he = JSON.parse(read('../src/i18n/he.json')) as { clientOperations: { annual: Record<string, string> } };
  const en = JSON.parse(read('../src/i18n/en.json')) as { clientOperations: { annual: Record<string, string> } };
  assert.match(annual, /data-testid="annual-client-document-list"/);
  assert.equal(he.clientOperations.annual.clientDocumentList, 'רשימת מסמכים ללקוח');
  assert.equal(en.clientOperations.annual.clientDocumentList, 'Client document list');
});
