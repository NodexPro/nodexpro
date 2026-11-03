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
