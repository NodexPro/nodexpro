/**
 * הגדרות הנה״ח tab — presentation contract only (no accounting calculations).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const profileSrc = readFileSync(join(dir, '../src/components/ClientBusinessProfileTab.tsx'), 'utf8');
const accountingSrc = readFileSync(join(dir, '../src/components/ClientAccountingSettingsTab.tsx'), 'utf8');
const panelSrc = readFileSync(join(dir, '../src/components/ClientWorkspacePanel.tsx'), 'utf8');
const accountingCss = readFileSync(join(dir, '../src/styles/nx-workspace-accounting-tab.css'), 'utf8');
const taxesCss = readFileSync(join(dir, '../src/styles/nx-workspace-taxes-tab.css'), 'utf8');
const taxesSrc = readFileSync(join(dir, '../src/components/ClientTaxesTab.tsx'), 'utf8');
const premium = readFileSync(join(dir, '../src/styles/nx-workspace-modal-premium.css'), 'utf8');

test('Accounting Settings tab still renders existing business-profile fields from the aggregate', () => {
  assert.match(profileSrc, /section\.section_label/);
  assert.match(profileSrc, /section\.fields/);
  assert.match(profileSrc, /f\.group_key/);
  assert.match(profileSrc, /f\.group_label/);
  for (const key of [
    'business_domain',
    'business_activity_description',
    'business_address',
    'private_address',
    'business_operation_mode',
    'primary_customer_type',
    'is_seasonal_business',
    'peak_months',
    'business_open_date',
    'business_close_date',
  ]) {
    assert.match(profileSrc, new RegExp(`'${key}'`));
  }
  assert.match(profileSrc, /save_accounting_business_profile/);
  assert.match(profileSrc, /onCaseUpdated\(fullCase\)/);
  assert.match(profileSrc, /formatDisplayValue\(f, f\.value\)/);
});

test('Accounting Settings blocks stay in existing order with named commands and full-case refresh', () => {
  assert.match(accountingSrc, /blockOrder:\s*BlockKey\[\]\s*=\s*\['income',\s*'expense_management',\s*'expenses',\s*'vehicles'\]/);
  assert.match(accountingSrc, /documents.*מוסתר/);
  assert.match(accountingSrc, /moduleClientOperationsAccountingCommands/);
  assert.match(accountingSrc, /onAccountingCaseUpdated/);
  assert.match(accountingSrc, /openModal\(b\)/);
  assert.match(accountingSrc, /b\.expense_management_zones/);
  assert.match(accountingSrc, /b\.block_key === 'income'/);
  assert.match(accountingSrc, /b\.block_key === 'expenses'/);
  assert.match(accountingSrc, /b\.block_key === 'vehicles'/);
});

test('Accounting Settings premium skin is scoped to the workspace modal Accounting interior', () => {
  assert.match(profileSrc, /nx-workspace-accounting-tab\.css/);
  assert.match(accountingSrc, /nx-workspace-accounting-tab\.css/);
  assert.match(panelSrc, /className="nx-ws-accounting"/);
  assert.match(accountingCss, /\.nx-modal\.nx-workspace-modal \.nx-ws-accounting/);
  assert.match(accountingCss, /nx-ws-accounting-card/);
  assert.match(accountingCss, /nx-ws-accounting-profile-groups/);
  assert.match(accountingCss, /repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(accountingCss, /overflow-y:\s*auto/);
  assert.match(accountingCss, /nx-taxes-section-edit-btn/);
  assert.doesNotMatch(accountingCss, /display:\s*none/);
  assert.doesNotMatch(accountingCss, /createPortal|translateY\(max\(-60px/);
});

test('Client Details, Taxes, portal and raise are not altered by the Accounting Settings restyle', () => {
  assert.match(panelSrc, /createPortal\(\s*overlay,\s*document\.body\s*\)/);
  assert.match(
    premium,
    /transform:\s*translateY\(\s*max\(\s*-60px,\s*calc\(\s*16px\s*-\s*50dvh\s*\+\s*50%\s*\)\s*\)\s*\)/,
  );
  assert.doesNotMatch(premium, /nx-ws-accounting/);
  assert.doesNotMatch(taxesCss, /nx-ws-accounting/);
  assert.match(taxesSrc, /client-profile-card nx-ws-taxes/);
  assert.match(panelSrc, /activeTab === 'taxes'/);
  assert.match(panelSrc, /ClientTaxesTab/);
});
