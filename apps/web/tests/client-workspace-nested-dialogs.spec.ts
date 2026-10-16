/**
 * Client Workspace nested dialogs — presentation contract only.
 * Does not change commands, aggregates, portal, raise, or the primary Close.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

const panelSrc = read('../src/components/ClientWorkspacePanel.tsx');
const nestedCss = read('../src/styles/nx-workspace-nested-dialogs.css');
const premium = read('../src/styles/nx-workspace-modal-premium.css');
const globalModal = read('../src/styles/nx-modal.css');
const taxesSrc = read('../src/components/ClientTaxesTab.tsx');
const accountingSrc = read('../src/components/ClientAccountingSettingsTab.tsx');
const profileSrc = read('../src/components/ClientBusinessProfileTab.tsx');
const docsSrc = read('../src/components/ClientDocumentsTab.tsx');
const docsCss = read('../src/styles/nx-workspace-documents-tab.css');
const annualSrc = read('../src/components/ClientAnnualReportTab.tsx');
const feesSrc = read('../src/components/ClientFeesTab.tsx');
const payrollSrc = read('../src/components/ClientPayrollTab.tsx');
const historySrc = read('../src/components/ClientHistoryTab.tsx');
const closeSrc = read('../src/components/WorkspaceNestedDialogClose.tsx');

test('Nested dialog skin is scoped and imported from the workspace panel', () => {
  assert.match(panelSrc, /nx-workspace-nested-dialogs\.css/);
  assert.match(nestedCss, /\.nx-modal\.nx-workspace-modal \.nx-modal-overlay > \.nx-modal:not\(\.nx-workspace-modal\)/);
  assert.match(nestedCss, /font-family:\s*Arial, sans-serif/);
  assert.match(nestedCss, /linear-gradient\(165deg, #04152f 0%, #082652 46%, #124c9a 78%, #04152f 100%\)/);
  assert.match(nestedCss, /rgba\(255, 255, 255, 0\.94\).*rgba\(232, 244, 255, 0\.84\)/s);
  assert.match(nestedCss, /color:\s*#0b2248/);
  assert.match(nestedCss, /\.nx-history-section-modal/);
  assert.match(nestedCss, /\.nx-annual-dialog/);
  assert.match(nestedCss, /inset:\s*12px auto auto 12px/);
  assert.match(nestedCss, /min-height:\s*56px/);
  assert.match(nestedCss, /#B8D9FF/);
  assert.match(nestedCss, /\.nx-em-modal-2col/);
  assert.match(nestedCss, /#0B2248/);
  assert.doesNotMatch(nestedCss, /createPortal|translateY\(max\(-60px/);
  assert.doesNotMatch(nestedCss, /\.nx-workspace-close\s*\{[^}]*inset:\s*(?!14px 16px auto auto)/);
});

test('Primary workspace portal, raise and Close stay on the premium shell', () => {
  assert.match(panelSrc, /createPortal\(\s*overlay,\s*document\.body\s*\)/);
  assert.match(
    premium,
    /transform:\s*translateY\(\s*max\(\s*-60px,\s*calc\(\s*16px\s*-\s*50dvh\s*\+\s*50%\s*\)\s*\)\s*\)/,
  );
  assert.match(premium, /inset:\s*14px 16px auto auto/);
  assert.doesNotMatch(premium, /nx-ws-nested|nx-fees-editor-modal|nx-cdocs-folder-panel/);
  assert.match(globalModal, /\.nx-modal\s*\{[^}]*background:\s*#fff/s);
});

test('Redundant footer סגירה is replaced with a top-left X; functional actions remain', () => {
  assert.match(closeSrc, /className=.*nx-modal-close/);
  assert.match(closeSrc, /aria-label=\{labelHe\}/);
  assert.match(feesSrc, /className="nx-modal-close"/);
  assert.match(feesSrc, /שמירה/);
  assert.doesNotMatch(feesSrc, /nx-modal-footer[\s\S]*סגירה[\s\S]*שמירה/);
  assert.match(feesSrc, /fxMeta\.cancel_he/);
  assert.match(payrollSrc, /className="nx-modal-close"/);
  assert.match(payrollSrc, /שמירה/);
  assert.doesNotMatch(payrollSrc, /סגירה/);
  assert.match(historySrc, /className="nx-modal-close"/);
  assert.match(historySrc, /ייצוא לאקסל/);
  assert.match(historySrc, /הפקת דוח PDF/);
  assert.doesNotMatch(historySrc, /onClick=\{closeSectionModal\}>\s*סגירה/);
  assert.match(docsSrc, /nx-cdocs-folder-panel-close/);
  assert.match(docsSrc, /WorkspaceNestedDialogClose/);
  assert.doesNotMatch(docsSrc, /onClick=\{closeFolder\}>\s*סגירה/);
  assert.match(docsSrc, /ביטול/);
  assert.match(accountingSrc, /WorkspaceNestedDialogClose/);
  assert.match(accountingSrc, /שמירה/);
  assert.doesNotMatch(accountingSrc, /onClick=\{\(\) => setModalOpen\(false\)\}[\s\S]{0,180}סגירה/);
  assert.doesNotMatch(accountingSrc, /onClick=\{\(\) => setVehicleItemOpen\(false\)\}[\s\S]{0,80}סגירה/);
  assert.match(profileSrc, /WorkspaceNestedDialogClose/);
  assert.match(profileSrc, /ביטול/);
  assert.match(annualSrc, /WorkspaceNestedDialogClose/);
  assert.match(annualSrc, /ביטול/);
  assert.match(annualSrc, /שמירה/);
  assert.match(taxesSrc, /WorkspaceNestedDialogClose/);
  assert.match(taxesSrc, /ביטול/);
});

test('Documents overlay and Fees editor keep aggregate reads and named commands', () => {
  assert.match(docsSrc, /documentsTab\.folders_grid\.folders/);
  assert.match(docsSrc, /documentsTab\.open_folder/);
  assert.match(docsSrc, /moduleClientOperationsDocumentsCommands/);
  assert.match(docsSrc, /onCaseUpdated\(out\)/);
  assert.match(docsCss, /linear-gradient\(165deg, #04152f 0%, #082652 46%, #124c9a 78%, #04152f 100%\)/);
  assert.match(feesSrc, /feesTab\.edit_modal/);
  assert.match(feesSrc, /moduleClientOperationsFeesCommands/);
  assert.match(feesSrc, /onCaseUpdated/);
  assert.match(nestedCss, /\.nx-fees-editor-modal \.nx-fees-table-wrap/);
  assert.match(nestedCss, /overflow-x:\s*auto/);
  for (const src of [docsSrc, feesSrc, taxesSrc, accountingSrc, payrollSrc, historySrc, annualSrc, profileSrc]) {
    assert.doesNotMatch(src, /method:\s*'PATCH'/);
  }
});
