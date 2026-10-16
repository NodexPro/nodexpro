/**
 * דוח שנתי / הצהרת הון — presentation contract only (no tax calculations).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const annualSrc = readFileSync(join(dir, '../src/components/ClientAnnualReportTab.tsx'), 'utf8');
const annualCss = readFileSync(join(dir, '../src/styles/nx-workspace-annual-tab.css'), 'utf8');
const annualBase = readFileSync(join(dir, '../src/styles/nx-annual-report-tab.css'), 'utf8');
const premium = readFileSync(join(dir, '../src/styles/nx-workspace-modal-premium.css'), 'utf8');
const panelSrc = readFileSync(join(dir, '../src/components/ClientWorkspacePanel.tsx'), 'utf8');
const taxesCss = readFileSync(join(dir, '../src/styles/nx-workspace-taxes-tab.css'), 'utf8');

test('Annual and capital-declaration tabs still render aggregate sections and named commands', () => {
  assert.match(annualSrc, /annualTab\.status_card_title_he/);
  assert.match(annualSrc, /annualTab\.documents_table/);
  assert.match(annualSrc, /annualTab\.submissions_table/);
  assert.match(annualSrc, /annualTab\.notes_card/);
  assert.match(annualSrc, /annualTab\.visibility\.show_documents/);
  assert.match(annualSrc, /moduleClientOperationsAnnualCommands/);
  assert.match(annualSrc, /onCaseUpdated/);
  for (const cmd of [
    'update_annual_notes',
    'add_annual_document_row',
    'remove_annual_document_row',
    'add_annual_submission_date',
    'update_annual_submission_date',
  ]) {
    assert.match(annualSrc, new RegExp(cmd));
  }
  assert.doesNotMatch(annualSrc, /method:\s*'PATCH'/);
});

test('Annual premium skin is scoped to the workspace modal and reused for הצהרת הון', () => {
  assert.match(annualSrc, /nx-workspace-annual-tab\.css/);
  assert.match(annualSrc, /nx-annual-root nx-ws-annual/);
  assert.match(panelSrc, /activeTab === 'annual'/);
  assert.match(panelSrc, /activeTab === 'equity'/);
  assert.match(panelSrc, /capital_declaration_tab/);
  assert.match(annualCss, /\.nx-modal\.nx-workspace-modal \.nx-ws-annual/);
  assert.match(annualCss, /background:\s*transparent/);
  assert.match(annualCss, /radial-gradient\(ellipse at 12% 0%, rgba\(255, 255, 255, 0\.2\)/);
  assert.match(annualCss, /overflow-y:\s*auto/);
  assert.doesNotMatch(annualCss, /createPortal|translateY\(max\(-60px/);
  assert.match(annualBase, /\.nx-annual-root/);
});

test('Taxes interior and portal/raise are not altered by the Annual restyle', () => {
  assert.match(panelSrc, /createPortal\(\s*overlay,\s*document\.body\s*\)/);
  assert.match(
    premium,
    /transform:\s*translateY\(\s*max\(\s*-60px,\s*calc\(\s*16px\s*-\s*50dvh\s*\+\s*50%\s*\)\s*\)\s*\)/,
  );
  assert.doesNotMatch(premium, /nx-ws-annual/);
  assert.doesNotMatch(taxesCss, /nx-ws-annual/);
  assert.match(taxesCss, /nx-ws-taxes-card/);
});
