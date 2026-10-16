/**
 * שכ״ט / שכר / היסטוריה — presentation contract only (aggregate + commands unchanged).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const feesSrc = readFileSync(join(dir, '../src/components/ClientFeesTab.tsx'), 'utf8');
const payrollSrc = readFileSync(join(dir, '../src/components/ClientPayrollTab.tsx'), 'utf8');
const historySrc = readFileSync(join(dir, '../src/components/ClientHistoryTab.tsx'), 'utf8');
const feesCss = readFileSync(join(dir, '../src/styles/nx-workspace-fees-tab.css'), 'utf8');
const payrollCss = readFileSync(join(dir, '../src/styles/nx-workspace-payroll-tab.css'), 'utf8');
const historyCss = readFileSync(join(dir, '../src/styles/nx-workspace-history-tab.css'), 'utf8');
const premium = readFileSync(join(dir, '../src/styles/nx-workspace-modal-premium.css'), 'utf8');
const panelSrc = readFileSync(join(dir, '../src/components/ClientWorkspacePanel.tsx'), 'utf8');
const taxesCss = readFileSync(join(dir, '../src/styles/nx-workspace-taxes-tab.css'), 'utf8');
const taxesSrc = readFileSync(join(dir, '../src/components/ClientTaxesTab.tsx'), 'utf8');

test('Fees, payroll and history still read aggregates and write named commands', () => {
  assert.match(feesSrc, /feesTab\.visibility/);
  assert.match(feesSrc, /moduleClientOperationsFeesCommands/);
  assert.match(feesSrc, /onCaseUpdated/);
  assert.match(payrollSrc, /payrollTab\.sections/);
  assert.match(payrollSrc, /moduleClientOperationsPayrollCommands/);
  assert.match(payrollSrc, /onCaseUpdated\(out\)/);
  assert.match(historySrc, /historyTab\.sections/);
  assert.match(historySrc, /moduleClientOperationsHistoryCommands/);
  assert.doesNotMatch(feesSrc, /method:\s*'PATCH'/);
  assert.doesNotMatch(payrollSrc, /method:\s*'PATCH'/);
  assert.doesNotMatch(historySrc, /method:\s*'PATCH'/);
});

test('Fees, payroll and history premium skins are scoped to the workspace modal interiors', () => {
  assert.match(feesSrc, /nx-workspace-fees-tab\.css/);
  assert.match(feesSrc, /nx-fees-tab-root nx-ws-fees/);
  assert.match(payrollSrc, /nx-workspace-payroll-tab\.css/);
  assert.match(payrollSrc, /nx-payroll-tab-root nx-ws-payroll/);
  assert.match(historySrc, /nx-workspace-history-tab\.css/);
  assert.match(historySrc, /nx-history-root nx-ws-history/);
  for (const css of [feesCss, payrollCss, historyCss]) {
    assert.match(css, /\.nx-modal\.nx-workspace-modal/);
    assert.match(css, /radial-gradient\(ellipse at 12% 0%, rgba\(255, 255, 255, 0\.2\)/);
    assert.match(css, /overflow-y:\s*auto/);
    assert.match(css, /overflow-x:\s*hidden/);
    assert.doesNotMatch(css, /createPortal|translateY\(max\(-60px/);
  }
});

test('Fees editor keeps named save and replaces redundant סגירה with the existing X', () => {
  assert.match(feesSrc, /moduleClientOperationsFeesCommands/);
  assert.match(feesSrc, /className="nx-modal-close"/);
  assert.match(feesSrc, /שמירה/);
  assert.match(feesSrc, /fxMeta\.cancel_he/);
  assert.doesNotMatch(feesSrc, /nx-modal-footer[\s\S]*סגירה[\s\S]*שמירה/);
});

test('Client Details, Taxes, portal and raise are not altered by remaining-tab restyles', () => {
  assert.match(panelSrc, /createPortal\(\s*overlay,\s*document\.body\s*\)/);
  assert.match(
    premium,
    /transform:\s*translateY\(\s*max\(\s*-60px,\s*calc\(\s*16px\s*-\s*50dvh\s*\+\s*50%\s*\)\s*\)\s*\)/,
  );
  assert.doesNotMatch(premium, /nx-ws-fees|nx-ws-payroll|nx-ws-history/);
  assert.doesNotMatch(taxesCss, /nx-ws-fees|nx-ws-payroll|nx-ws-history/);
  assert.match(taxesSrc, /client-profile-card nx-ws-taxes/);
  assert.match(panelSrc, /activeTab === 'fees'/);
  assert.match(panelSrc, /activeTab === 'salary'/);
  assert.match(panelSrc, /activeTab === 'history'/);
});
