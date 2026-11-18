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
const appSrc = readFileSync(join(dir, '../src/App.tsx'), 'utf8');
const registrySrc = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
const caseSrc = readFileSync(join(dir, '../src/pages/ClientOperationsClientCase.tsx'), 'utf8');
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
  assert.match(annualCss, /col\.nx-annual-col--note/);
  assert.match(annualCss, /box-sizing:\s*border-box/);
  assert.match(annualSrc, /nx-annual-note-inp/);
  assert.doesNotMatch(annualCss, /createPortal|translateY\(max\(-60px/);
  assert.match(annualBase, /\.nx-annual-root/);
});

test('capital archive folders stay linked to instances and default open', () => {
  assert.match(annualSrc, /annualTab\.capital_folders/);
  assert.match(annualSrc, /data-instance-id=\{folder\.instance_id\}/);
  assert.match(annualSrc, /annual-tab-capital-folder-\$\{folder\.sequence_no\}/);
  assert.match(annualSrc, /next\[folder\.folder_key\] = true/);
  assert.match(annualSrc, /file\.actions\?\.can_preview \?\? file\.can_open/);
});

test('Annual tab renders backend filing years, separate document readiness, and archive folders at the bottom', () => {
  assert.match(annualSrc, /annualTab\.filing_years/);
  assert.match(annualSrc, /select_annual_working_tax_year/);
  assert.match(annualSrc, /annual-tab-year-tabs/);
  assert.match(annualSrc, /selectYearTab/);
  assert.doesNotMatch(annualSrc, /void postCmd\('select_annual_working_tax_year'/);
  assert.match(annualSrc, /show_working_checklist/);
  assert.match(annualSrc, /annual-tab-filed-confirmation/);
  assert.match(annualSrc, /annual-tab-document-readiness/);
  assert.match(annualSrc, /AnnualArchiveFolders/);
  assert.match(annualSrc, /annual-tab-logical-folders/);
  const foldersIdx = annualSrc.indexOf('<AnnualArchiveFolders');
  const docsIdx = annualSrc.indexOf('annualTab.visibility.show_documents');
  const notesIdx = annualSrc.indexOf('annualTab.visibility.show_notes');
  assert.ok(docsIdx > 0 && notesIdx > docsIdx && foldersIdx > notesIdx);
  assert.match(annualBase, /font-family:\s*Arial/);
  assert.match(annualCss, /font-family:\s*Arial/);
  assert.match(annualBase, /\.nx-annual-logical-folder \{[\s\S]*?linear-gradient\(180deg, rgba\(8, 38, 82/);
  const he = readFileSync(join(dir, '../src/i18n/he.json'), 'utf8');
  assert.match(he, /"notFiledStatus": "לא הוגש"/);
  assert.match(he, /"documentReadiness"/);
  assert.doesNotMatch(annualSrc, /new Date\(\)\.getFullYear\(\)/);
});

test('Client Operations route never stays on a blank page: error boundary, retry, no unauthenticated null', () => {
  assert.match(appSrc, /ClientOperationsRouteErrorBoundary/);
  assert.match(registrySrc, /auth\.status !== 'authenticated'/);
  assert.doesNotMatch(registrySrc, /if \(auth\.status !== 'authenticated'\) return null;/);
  assert.match(caseSrc, /client-operations-case-error/);
  assert.match(caseSrc, /clientOperations\.retry/);
});

test('year switch uses in-aggregate year_views and does not reload the client case on tab click', () => {
  assert.match(annualSrc, /annualTab\.year_views/);
  assert.match(annualSrc, /persistWorkingYear/);
  assert.match(annualSrc, /resolveDisplayedAnnualTaxYear/);
  assert.match(annualSrc, /if \(apply\) onCaseUpdated\(out\)/);
  assert.match(annualSrc, /isAnnualBoard \? null : annualTab\.filing_status/);
  assert.match(annualSrc, /annual-tab-filing-status-loading/);
  assert.doesNotMatch(annualSrc, /moduleClientOperationsCase\(/);
});

test('filed year uses available width; hidden checklist does not leave an empty column', () => {
  assert.match(annualSrc, /nx-annual-dashboard\$\{showMissingProblem \? '' : ' is-single'\}/);
  assert.match(annualSrc, /nx-annual-lower\$\{/);
  assert.match(annualSrc, /is-single/);
  assert.doesNotMatch(annualSrc, /show_submissions \? \([\s\S]*\) : \(\s*<div \/>\s*\)/s);
  assert.match(annualBase, /\.nx-annual-dashboard\.is-single/);
  assert.match(annualBase, /\.nx-annual-lower\.is-single/);
  assert.match(annualBase, /\.nx-annual-notes-ta \{[\s\S]*min-height:\s*88px/);
  assert.match(annualBase, /\.nx-annual-lower \{[\s\S]*align-items:\s*start/);
  const foldersIdx = annualSrc.indexOf('<AnnualArchiveFolders');
  const notesIdx = annualSrc.indexOf('annualTab.visibility.show_notes');
  const checklistIdx = annualSrc.indexOf('{showChecklist ? (');
  assert.ok(checklistIdx > 0 && notesIdx > checklistIdx && foldersIdx > notesIdx);
});

test('working checklist heading uses the selected tax year and hides when the year is filed', () => {
  assert.match(annualSrc, /documentsForTaxYear/);
  assert.match(annualSrc, /annual-tab-documents-year-heading/);
  assert.match(annualSrc, /show_working_checklist/);
  assert.match(annualSrc, /fillI18n\([\s\S]*year: displayedYear/);
  const he = readFileSync(join(dir, '../src/i18n/he.json'), 'utf8');
  assert.match(he, /"documentsForTaxYear": "מסמכים לשנת מס \{\{year\}\}"/);
  const headingIdx = annualSrc.indexOf('annual-tab-documents-year-heading');
  const checklistIdx = annualSrc.indexOf('{showChecklist ? (');
  assert.ok(checklistIdx > 0 && headingIdx > checklistIdx);
});

test('older tax year uses the existing named command and archive stays independent of the selected tab', () => {
  assert.match(annualSrc, /annualTab\.older_tax_years/);
  assert.match(annualSrc, /annual-tab-older-year-select/);
  assert.match(annualSrc, /select_annual_working_tax_year/);
  assert.match(annualSrc, /AnnualArchiveFolders/);
  assert.match(annualSrc, /annualTab\.year_folders/);
  assert.doesNotMatch(annualSrc, /getFullYear\(/);
  const foldersIdx = annualSrc.indexOf('<AnnualArchiveFolders');
  const olderIdx = annualSrc.indexOf('annual-tab-older-year-select');
  const notesIdx = annualSrc.indexOf('annualTab.visibility.show_notes');
  assert.ok(olderIdx > 0 && notesIdx > olderIdx && foldersIdx > notesIdx);
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
