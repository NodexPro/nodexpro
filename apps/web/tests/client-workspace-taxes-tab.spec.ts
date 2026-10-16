/**
 * מיסים tab — presentation contract only (no tax calculations).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const taxesSrc = readFileSync(join(dir, '../src/components/ClientTaxesTab.tsx'), 'utf8');
const taxesCss = readFileSync(join(dir, '../src/styles/nx-workspace-taxes-tab.css'), 'utf8');
const premium = readFileSync(join(dir, '../src/styles/nx-workspace-modal-premium.css'), 'utf8');
const panelSrc = readFileSync(join(dir, '../src/components/ClientWorkspacePanel.tsx'), 'utf8');

test('Taxes tab still renders aggregate summary rows and existing section keys', () => {
  assert.match(taxesSrc, /taxTab\.header\.summary_rows/);
  assert.match(taxesSrc, /taxTab\.header\.title_he/);
  for (const key of [
    'vat_registration',
    'income_tax_advances',
    'income_tax_deductions',
    'national_insurance',
    'vat_payment',
    'income_tax_payment',
    'notes',
  ]) {
    assert.match(taxesSrc, new RegExp(`section_key === '${key}'`));
  }
  assert.match(taxesSrc, /sec\.display_rows\.map/);
  assert.match(taxesSrc, /sec\.edit\.enabled/);
  assert.match(taxesSrc, /onOpenEditor\(sec\.section_key\)/);
});

test('Taxes tab writes remain named tax commands and full-case refresh', () => {
  assert.match(taxesSrc, /moduleClientOperationsTaxCommands/);
  assert.match(taxesSrc, /onTaxSettingsUpdated/);
  assert.doesNotMatch(taxesSrc, /heVatType|heVatFrequency|heTriState/);
});

test('Taxes premium skin is scoped to the workspace modal Taxes interior', () => {
  assert.match(taxesSrc, /nx-workspace-taxes-tab\.css/);
  assert.match(taxesSrc, /client-profile-card nx-ws-taxes/);
  assert.match(taxesCss, /\.nx-modal\.nx-workspace-modal \.nx-ws-taxes/);
  assert.match(taxesCss, /nx-ws-taxes-summary__grid/);
  assert.match(taxesCss, /repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(taxesCss, /nx-ws-taxes-card/);
  assert.match(taxesCss, /nx-taxes-section-edit-btn/);
  assert.match(taxesCss, /overflow-y:\s*auto/);
  assert.doesNotMatch(taxesCss, /display:\s*none/);
  assert.doesNotMatch(taxesCss, /createPortal|translateY\(max\(-60px/);
});

test('Client Details shell, portal and raise are not altered by the Taxes restyle', () => {
  assert.match(panelSrc, /createPortal\(\s*overlay,\s*document\.body\s*\)/);
  assert.match(
    premium,
    /transform:\s*translateY\(\s*max\(\s*-60px,\s*calc\(\s*16px\s*-\s*50dvh\s*\+\s*50%\s*\)\s*\)\s*\)/,
  );
  assert.doesNotMatch(premium, /nx-ws-taxes/);
});
