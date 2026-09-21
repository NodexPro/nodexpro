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

test('bottom month period tabs are a separate navigation system (untouched contract)', () => {
  assert.match(periodTabsSrc, /selectedPeriodKey/);
  assert.match(periodTabsSrc, /available_periods|availablePeriods/);
  assert.doesNotMatch(periodTabsSrc, /HIDDEN_WORKSPACE_NAV_TAB_KEYS|התחייבויות/);
  assert.doesNotMatch(periodTabsSrc, /nx-workspace-tabs-bar/);
});
