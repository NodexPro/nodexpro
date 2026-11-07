/**
 * Client Operations uses the existing platform locale (session ui_language → useI18n).
 * Source-contract checks: no new i18n system, EN/HE dictionaries stay aligned,
 * direction follows document locale instead of hardcoded RTL.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const en = JSON.parse(readFileSync(join(root, 'src/i18n/en.json'), 'utf8')) as Record<string, unknown>;
const he = JSON.parse(readFileSync(join(root, 'src/i18n/he.json'), 'utf8')) as Record<string, unknown>;
const header = readFileSync(
  join(root, 'src/templates/template-1/components/ClientOperationsAppHeader.tsx'),
  'utf8',
);
const panel = readFileSync(join(root, 'src/components/ClientWorkspacePanel.tsx'), 'utf8');
const periodTabs = readFileSync(
  join(root, 'src/components/client-operations/ClientOperationsPeriodSheetTabs.tsx'),
  'utf8',
);
const registry = readFileSync(
  join(root, 'src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const provider = readFileSync(join(root, 'src/i18n/I18nProvider.tsx'), 'utf8');
const appShell = readFileSync(join(root, 'src/components/layout/AppShell.tsx'), 'utf8');

function collectKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return prefix ? [prefix] : [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

test('Client Operations dictionaries exist in both EN and HE with the same keys', () => {
  const enCo = en.clientOperations;
  const heCo = he.clientOperations;
  assert.equal(typeof enCo, 'object');
  assert.equal(typeof heCo, 'object');
  const enKeys = collectKeys(enCo).sort();
  const heKeys = collectKeys(heCo).sort();
  assert.deepEqual(enKeys, heKeys);
  assert.ok(enKeys.includes('moduleTitle'));
  assert.ok(enKeys.includes('tabs.client'));
  assert.ok(enKeys.includes('searchPlaceholder'));
});

test('English Client Operations chrome is English and Hebrew chrome stays Hebrew', () => {
  const enCo = en.clientOperations as { moduleTitle: string; search: string; tabs: { client: string } };
  const heCo = he.clientOperations as { moduleTitle: string; search: string; tabs: { client: string } };
  assert.equal(enCo.moduleTitle, 'Client Operations');
  assert.equal(enCo.search, 'Search');
  assert.equal(enCo.tabs.client, 'Client details');
  assert.match(heCo.moduleTitle, /ניהול לקוחות/);
  assert.match(heCo.search, /חיפוש/);
  assert.match(heCo.tabs.client, /פרטי לקוח/);
});

test('Client Operations uses the existing I18nProvider and session language sync', () => {
  assert.match(provider, /document\.documentElement\.dir = lang === 'he' \? 'rtl' : 'ltr'/);
  assert.match(provider, /public\/i18n\//);
  assert.match(appShell, /function SessionLanguageSync/);
  assert.match(appShell, /language_selector\?\.current_value/);
  assert.match(header, /useI18n/);
  assert.match(panel, /useI18n/);
  assert.match(registry, /useI18n/);
  assert.match(periodTabs, /useI18n/);
});

test('Client Operations chrome follows platform direction instead of hardcoded RTL', () => {
  assert.doesNotMatch(header, /dir="rtl"/);
  assert.doesNotMatch(periodTabs, /dir="rtl"/);
  assert.doesNotMatch(panel, /style=\{\{ direction: 'rtl' \}\}/);
  assert.match(registry, /printDir = lang === 'he' \? 'rtl' : 'ltr'/);
});

test('workspace tabs and registry search render through clientOperations keys', () => {
  assert.match(panel, /t\(tab\.labelKey\)/);
  assert.match(panel, /clientOperations\.fields\.clientName/);
  assert.match(panel, /clientOperations\.status\.active/);
  assert.match(registry, /t\('clientOperations\.searchPlaceholder'\)/);
  assert.match(registry, /t\('clientOperations\.sheetTools'\)/);
  assert.match(registry, /clientOperations\.copyFromMonth/);
  assert.match(registry, /clientOperations\.configuredNoReportThisMonth/);
});

test('registry columns, filters, business types and tax cards have EN/HE dictionary keys', () => {
  const enCo = en.clientOperations as Record<string, any>;
  const heCo = he.clientOperations as Record<string, any>;
  assert.equal(enCo.registry.columns.clientName, 'Client name');
  assert.equal(heCo.registry.columns.clientName, 'שם לקוח');
  assert.equal(enCo.registry.columns.handler, 'Case manager');
  assert.equal(heCo.registry.columns.handler, 'מטפל בתיק');
  assert.equal(enCo.registry.columns.annualReport, 'Annual report');
  assert.equal(heCo.registry.columns.annualReport, 'דוח שנתי');
  assert.equal(enCo.businessType.osekPatur, 'Exempt dealer');
  assert.equal(heCo.businessType.osekPatur, 'עוסק פטור');
  assert.equal(enCo.businessType.osekMurshe, 'VAT-registered dealer');
  assert.equal(heCo.businessType.osekMurshe, 'עוסק מורשה');
  assert.equal(enCo.businessType.company, 'Company');
  assert.equal(heCo.businessType.company, 'חברה');
  assert.equal(enCo.yes, 'Yes');
  assert.equal(enCo.no, 'No');
  assert.equal(heCo.yes, 'כן');
  assert.equal(heCo.no, 'לא');
  assert.equal(enCo.enums.frequency.biMonthly, 'Bimonthly');
  assert.equal(heCo.enums.frequency.biMonthly, 'דו-חודשי');
  assert.equal(enCo.taxes.cards.vatRegistration, 'VAT registration');
  assert.equal(heCo.taxes.cards.vatRegistration, 'רישום מע״מ');
  assert.equal(enCo.taxes.cards.incomeTaxAdvances, 'Income tax advances');
  assert.equal(heCo.taxes.cards.incomeTaxAdvances, 'מקדמות מס הכנסה');
});

test('Client Operations registry and taxes render via label_key, not raw Hebrew', () => {
  const taxes = readFileSync(join(root, 'src/components/ClientTaxesTab.tsx'), 'utf8');
  assert.match(registry, /localizeSystemLabel/);
  assert.match(registry, /column\.label_key/);
  assert.match(registry, /cell_label_keys/);
  assert.match(registry, /def\.label_key/);
  assert.match(panel, /CLIENT_PROFILE_BUSINESS_TYPE_LABEL_KEY/);
  assert.match(taxes, /sec\.title_key/);
  assert.match(taxes, /clientOperations\.taxes\.cards\.vatRegistration/);
  assert.match(taxes, /clientOperations\.businessType|clientOperations\.enums|clientOperations\.yes/);
  assert.doesNotMatch(registry, /שם לקוח/);
  assert.doesNotMatch(taxes, /<h3 className="nx-modal-title">רישום מע״מ<\/h3>/);
});

test('payroll, business profile and taxes leftover chrome use clientOperations keys', () => {
  const payroll = readFileSync(join(root, 'src/components/ClientPayrollTab.tsx'), 'utf8');
  const profile = readFileSync(join(root, 'src/components/ClientBusinessProfileTab.tsx'), 'utf8');
  const taxes = readFileSync(join(root, 'src/components/ClientTaxesTab.tsx'), 'utf8');
  const todoBoard = readFileSync(
    join(root, 'src/components/client-operations/ClientOperationsTodoBoardModal.tsx'),
    'utf8',
  );
  const quick = readFileSync(
    join(root, 'src/components/client-operations/ClientOperationsClientQuickProfilePopover.tsx'),
    'utf8',
  );
  assert.match(payroll, /localizeSystemLabel/);
  assert.match(payroll, /ln\.line_key/);
  assert.doesNotMatch(payroll, /label_he === '/);
  assert.doesNotMatch(payroll, /style=\{\{ direction: 'rtl' \}\}/);
  assert.match(profile, /clientOperations\.editBusinessProfile/);
  assert.match(profile, /clientOperations\.save/);
  assert.match(taxes, /clientOperations\.taxes\.saveSuccess/);
  assert.match(taxes, /clientOperations\.taxes\.modals\.verifyTitle/);
  assert.match(todoBoard, /clientOperations\.todo\.taxId/);
  assert.match(todoBoard, /clientOperations\.todo\.markComplete/);
  assert.match(quick, /localizeSystemLabel/);
  assert.match(quick, /fillI18n/);
});

test('ToDo, notes and quick profile chrome use the same clientOperations dictionary', () => {
  const todoBoard = readFileSync(
    join(root, 'src/components/client-operations/ClientOperationsTodoBoardModal.tsx'),
    'utf8',
  );
  const notes = readFileSync(join(root, 'src/components/ClientNoteModal.tsx'), 'utf8');
  const quick = readFileSync(
    join(root, 'src/components/client-operations/ClientOperationsClientQuickProfilePopover.tsx'),
    'utf8',
  );
  assert.match(todoBoard, /clientOperations\.todo\.newTask/);
  assert.match(todoBoard, /clientOperations\.todo\.archiveTitle/);
  assert.match(todoBoard, /clientOperations\.todo\.emptyOpen/);
  assert.match(todoBoard, /lane\.labelKey/);
  assert.doesNotMatch(todoBoard, /dir="rtl"/);
  const registryErrors = readFileSync(
    join(root, 'src/lib/client-operations-registry-command-error.pure.ts'),
    'utf8',
  );
  assert.match(registryErrors, /CLIENT_OPERATIONS_PAYROLL_NOT_APPLICABLE/);
  assert.match(registryErrors, /localizeClientOperationsRegistryCommandError/);
  assert.match(notes, /clientOperations\.notes\.title/);
  assert.match(quick, /clientOperations\.quickProfile\.clientDetails/);
  assert.doesNotMatch(quick, /dir="rtl"/);
});
