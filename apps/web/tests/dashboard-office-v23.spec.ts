/**
 * Dashboard V2.3: glass modal, four server filters, language switch,
 * sticky independently scrolling sidebar, Settings glass tokens.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const dashSrc = readFileSync(join(dir, '../src/pages/Dashboard.tsx'), 'utf8');
const dashCss = readFileSync(join(dir, '../src/styles/nx-dashboard.css'), 'utf8');
const modalSrc = readFileSync(join(dir, '../src/components/dashboard/DashboardFeeBreakdownModal.tsx'), 'utf8');
const langSwitchSrc = readFileSync(join(dir, '../src/components/glass/UiLanguageSwitch.tsx'), 'utf8');
const settingsSrc = readFileSync(join(dir, '../src/pages/Settings.tsx'), 'utf8');
const glassCss = readFileSync(join(dir, '../src/styles/nx-glass-surface.css'), 'utf8');
const sidebarCss = readFileSync(join(dir, '../src/templates/template-1/t1-sidebar-account.css'), 'utf8');
const shellCss = readFileSync(join(dir, '../src/styles/nx-client-operations-shell.css'), 'utf8');
const layoutSrc = readFileSync(join(dir, '../src/templates/template-1/TemplateLayout.tsx'), 'utf8');
const officeProvider = readFileSync(
  join(dir, '../../api/src/domains/dashboard/providers/dashboard-office.provider.ts'),
  'utf8',
);
const breakdownPure = readFileSync(
  join(dir, '../../api/src/domains/dashboard/dashboard-office-fee-breakdown.pure.ts'),
  'utf8',
);
const officeCopy = readFileSync(join(dir, '../../api/src/domains/dashboard/dashboard-office-copy.pure.ts'), 'utf8');
const enI18n = readFileSync(join(dir, '../src/i18n/en.json'), 'utf8');
const heI18n = readFileSync(join(dir, '../src/i18n/he.json'), 'utf8');

test('sidebar stays viewport-sticky and scrolls its own nav independently of the page', () => {
  assert.match(sidebarCss, /\.t1-sidebar \{[\s\S]*position: sticky/);
  assert.match(sidebarCss, /\.t1-sidebar \{[\s\S]*height: 100vh/);
  assert.match(sidebarCss, /\.t1-sidebar__nav \{[\s\S]*overflow-y: auto/);
  assert.match(sidebarCss, /overscroll-behavior: contain/);
  assert.match(shellCss, /\.t1-appShell--client-operations \{[\s\S]*overflow: hidden/);
  assert.match(shellCss, /\.t1-shellColumn \{[\s\S]*overflow: auto/);
  assert.doesNotMatch(sidebarCss, /translateY\(|mousemove|clientY/);
});

test('monthly fee modal uses dashboard glass and purple action chips', () => {
  assert.match(dashCss, /\.nx-dashboard-breakdown \{[\s\S]*backdrop-filter: blur\(12px\)/);
  assert.match(dashCss, /\.nx-dashboard-chip--purple/);
  assert.match(dashCss, /\.nx-dashboard-btn--purple/);
  assert.match(modalSrc, /nx-dashboard-chip--purple/);
  assert.match(modalSrc, /dir=\{dir\}/);
  assert.doesNotMatch(dashCss, /\.nx-dashboard-breakdown \{[\s\S]*background:\s*#f/);
});

test('visible filters are All / No fee / Zero fee / One time and stay server-owned', () => {
  assert.match(breakdownPure, /VISIBLE_FEE_BREAKDOWN_FILTERS = \['all', 'no_fee', 'configured_zero', 'one_time_only'\]/);
  assert.match(officeProvider, /key: 'no_fee'/);
  assert.match(officeProvider, /key: 'configured_zero'/);
  assert.match(officeProvider, /key: 'one_time_only'/);
  assert.match(officeCopy, /breakdown_filter_no_fee: 'No fee'/);
  assert.match(officeCopy, /breakdown_filter_zero_fee: 'Zero fee'/);
  assert.match(officeCopy, /breakdown_filter_one_time: 'One time'/);
  assert.match(officeCopy, /breakdown_filter_no_fee: 'ללא שכ״ט'/);
  assert.doesNotMatch(modalSrc, /rows\.filter\(|clients\.filter\(/);
  assert.match(modalSrc, /URLSearchParams\(\{[\s\S]*filter,/);
});

test('agreement status column is dropped while discount and monthly columns remain', () => {
  assert.match(officeProvider, /key: 'client'/);
  assert.match(officeProvider, /key: 'frequency'/);
  assert.match(officeProvider, /key: 'before_discount'/);
  assert.match(officeProvider, /key: 'discount'/);
  assert.match(officeProvider, /key: 'monthly'/);
  assert.match(officeProvider, /key: 'status'/);
  assert.doesNotMatch(officeProvider, /key: 'agreement'/);
  assert.match(modalSrc, /cellFor\(/);
  assert.match(dashCss, /\.nx-dashboard-breakdown__table-wrap \{[\s\S]*overflow-x: auto/);
});

test('Dashboard language switch reuses setUiLanguage and existing I18n', () => {
  assert.match(dashSrc, /<UiLanguageSwitch/);
  assert.match(langSwitchSrc, /auth\.setUiLanguage\(code\)/);
  assert.match(langSwitchSrc, /setLang\(code\)/);
  assert.match(enI18n, /"en": "English"/);
  assert.match(heI18n, /"he": "עברית"/);
  assert.match(dashSrc, /locale=\$\{encodeURIComponent\(lang\)\}/);
  assert.match(dashSrc, /dir=\{dir\}/);
  assert.match(modalSrc, /locale=\{lang\}|locale,/);
});

test('modal unmounts when closed so opening does not double-fetch', () => {
  assert.match(dashSrc, /\{breakdownOpen \? \(/);
  assert.doesNotMatch(dashSrc, /<DashboardFeeBreakdownModal[\s\S]*open=\{breakdownOpen\}/);
  assert.match(modalSrc, /createPortal\(/);
  assert.match(modalSrc, /document\.body/);
});

test('Client Operations registry keeps internal sheet scroll after shared shell overflow', () => {
  assert.match(
    shellCss,
    /:has\(\.nx-co-sheet\) \.t1-shellColumn \{[\s\S]*overflow: hidden/,
  );
  assert.match(shellCss, /\.t1-appShell--client-operations \.t1-shellColumn \{[\s\S]*overflow: auto/);
  assert.match(shellCss, /:has\(\.nx-co-sheet\) \.t1-pageMain \{[\s\S]*overflow: hidden/);
});

test('Settings reuses shared navy-glass tokens without rewriting save commands', () => {
  assert.match(layoutSrc, /isSettings/);
  assert.match(settingsSrc, /nx-glass-surface\.css/);
  assert.match(settingsSrc, /nx-glass-page nx-settings/);
  assert.match(settingsSrc, /nx-glass-card/);
  assert.match(settingsSrc, /nx-glass-btn--purple/);
  assert.match(glassCss, /\.nx-glass-card \{[\s\S]*backdrop-filter: blur\(12px\)/);
  assert.match(settingsSrc, /method: 'PATCH'/);
  assert.match(settingsSrc, /orgSettings\(orgId\)/);
  assert.doesNotMatch(settingsSrc, /color: '#6b7280'/);
  assert.doesNotMatch(settingsSrc, /color: '#111827'/);
});
