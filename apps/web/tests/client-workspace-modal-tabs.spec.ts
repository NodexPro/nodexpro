/**
 * Client folder modal top navigation — hide התחייבויות + full-width remaining tabs.
 * Source-contract checks (no network).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const panelSrc = readFileSync(join(dir, '../src/components/ClientWorkspacePanel.tsx'), 'utf8');
const modalCss = readFileSync(join(dir, '../src/styles/nx-modal.css'), 'utf8');
const periodTabsSrc = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsPeriodSheetTabs.tsx'),
  'utf8',
);

test('התחייבויות is defined in TAB_ORDER but hidden from modal top nav', () => {
  assert.match(panelSrc, /key:\s*'obligations',\s*label:\s*'התחייבויות'/);
  assert.match(panelSrc, /HIDDEN_WORKSPACE_NAV_TAB_KEYS/);
  assert.match(panelSrc, /new Set<WorkspaceTabKey>\(\['obligations'\]\)/);
  assert.match(panelSrc, /isWorkspaceNavTabVisible/);
  assert.match(panelSrc, /TAB_ORDER\.filter\(\(t\) => isWorkspaceNavTabVisible/);
});

test('remaining top tabs stay in TAB_ORDER for rendering content', () => {
  for (const label of [
    'פרטי לקוח',
    'מיסים',
    'הגדרות הנה״ח',
    'מסמכים',
    'דוח שנתי',
    'הצהרת הון',
    'שכ״ט',
    'שכר',
    'היסטוריה',
  ]) {
    assert.match(panelSrc, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('hidden obligations tab falls back to a visible default tab', () => {
  assert.match(panelSrc, /!isWorkspaceNavTabVisible\(activeTab/);
  assert.match(panelSrc, /setActiveTab\('client'\)/);
  assert.match(panelSrc, /useState<WorkspaceTabKey>\('client'\)/);
});

test('obligations domain content is retained (not deleted)', () => {
  assert.match(panelSrc, /activeTab === 'obligations'/);
  assert.match(panelSrc, /client_obligations_tab/);
  assert.match(panelSrc, /ClientObligationsTab/);
});

test('full-width equal distribution CSS for remaining modal top tabs', () => {
  assert.match(modalCss, /\.nx-workspace-panel-root \.nx-workspace-tabs-bar/);
  assert.match(modalCss, /flex:\s*1\s+1\s+0/);
  assert.match(modalCss, /width:\s*100%/);
  assert.match(modalCss, /direction:\s*rtl/);
  assert.match(modalCss, /\.nx-workspace-tab-link-active/);
  assert.match(modalCss, /:focus-visible/);
});

test('client profile still persists only through the existing save command; footer is not hidden', () => {
  assert.match(panelSrc, /moduleClientOperationsUpdateClientProfile/);
  assert.match(panelSrc, /const handleSave = async/);
  assert.match(panelSrc, />\s*שמירה\s*</);
  assert.match(panelSrc, />\s*ביטול\s*</);
  assert.match(panelSrc, /nx-workspace-client-footer/);
  assert.doesNotMatch(panelSrc, /autosave|autoSave|auto-save/i);
  const premium = readFileSync(join(dir, '../src/styles/nx-workspace-modal-premium.css'), 'utf8');
  assert.doesNotMatch(premium, /nx-workspace-client-footer[^{]*\{[^}]*display:\s*none/);
  assert.doesNotMatch(premium, /שמירה|ביטול/);
});

test('premium modal skin is scoped and keeps a 3-column client-profile grid on desktop', () => {
  assert.match(panelSrc, /nx-workspace-modal-premium\.css/);
  assert.match(panelSrc, /createPortal/);
  assert.match(panelSrc, /createPortal\(\s*overlay,\s*document\.body\s*\)/);
  const premium = readFileSync(join(dir, '../src/styles/nx-workspace-modal-premium.css'), 'utf8');
  assert.match(premium, /\.nx-modal-overlay:has\(>\s*\.nx-modal\.nx-workspace-modal\)/);
  assert.match(premium, /\.nx-modal\.nx-workspace-modal/);
  assert.match(premium, /height:\s*auto\s*!important/);
  assert.match(premium, /max-height:\s*100%\s*!important/);
  assert.doesNotMatch(premium, /height:\s*100dvh/);
  assert.doesNotMatch(premium, /\.nx-modal-overlay:has\(>\s*\.nx-modal\.nx-workspace-modal\)::after/);
  assert.doesNotMatch(premium, /flex:\s*0 1 120px/);
  assert.match(
    premium,
    /transform:\s*translateY\(\s*max\(\s*-60px,\s*calc\(\s*16px\s*-\s*50dvh\s*\+\s*50%\s*\)\s*\)\s*\)/,
  );
  assert.match(premium, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(premium, /@container nx-workspace-modal \(max-width: 860px\)/);
  assert.match(premium, /@container nx-workspace-modal \(max-width: 520px\)/);
  assert.doesNotMatch(premium, /url\(|\.png|\.svg|animation:/);
  assert.match(premium, /0 0 12px rgba\(44, 196, 255, 0\.4\)/);
  assert.doesNotMatch(premium, /#659ad8|#457fca|#2c65ae/);
  assert.match(
    premium,
    /linear-gradient\(\s*180deg,\s*rgba\(248,\s*252,\s*255,\s*0\.2\) 0%,\s*rgba\(186,\s*216,\s*246,\s*0\.14\) 100%\)/,
  );
  assert.match(premium, /linear-gradient\(\s*115deg,\s*#277cff 0%,\s*#165dff 52%,\s*#6558e8 100%\)/);
  assert.match(premium, /:focus-within/);
  assert.match(premium, /linear-gradient\(\s*180deg,\s*#061733 0%,\s*#020d24 100%\)/);
  assert.match(premium, /-webkit-text-fill-color:\s*#eaf6ff/);
  assert.match(premium, /column-gap:\s*22px/);
  assert.match(premium, /row-gap:\s*12px/);
  assert.match(premium, /padding:\s*16px 20px/);
  assert.match(premium, /border-radius:\s*11px/);
  assert.match(premium, /height:\s*38px/);
  assert.doesNotMatch(premium, /margin-bottom:\s*-/);
  assert.doesNotMatch(premium, /^\s*top:\s*-?\d+px/m);
  assert.match(premium, /padding:\s*14px 16px 12px\s*!important/);
  assert.match(premium, /inset:\s*14px 16px auto auto/);
  assert.match(premium, /\.nx-workspace-logo \{[\s\S]*?width:\s*44px/);
});

test('client details field icons are decorative only and do not add a Notes field', () => {
  assert.match(panelSrc, /function ClientFieldDecorIcon/);
  assert.match(panelSrc, /aria-hidden="true"/);
  assert.match(panelSrc, /kind="building"/);
  assert.match(panelSrc, /kind="id-card"/);
  assert.match(panelSrc, /kind="briefcase"/);
  assert.match(panelSrc, /kind="calendar"/);
  assert.match(panelSrc, /client-field-decor-icon--status/);
  const premium = readFileSync(join(dir, '../src/styles/nx-workspace-modal-premium.css'), 'utf8');
  assert.match(premium, /\.client-field-decor-icon \{[^}]*order:\s*2;/);
  assert.match(premium, /client-field-decor-icon--status/);
  assert.doesNotMatch(panelSrc, /kind="notes"|kind="document"/);
  assert.doesNotMatch(panelSrc, /client-field-label">הערות</);
});

test('bottom month period tabs are a separate navigation system (untouched contract)', () => {
  assert.match(periodTabsSrc, /selectedPeriodKey/);
  assert.match(periodTabsSrc, /available_periods|availablePeriods/);
  assert.doesNotMatch(periodTabsSrc, /HIDDEN_WORKSPACE_NAV_TAB_KEYS|התחייבויות/);
  assert.doesNotMatch(periodTabsSrc, /nx-workspace-tabs-bar/);
});
