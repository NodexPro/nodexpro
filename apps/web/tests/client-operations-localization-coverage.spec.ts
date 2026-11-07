/**
 * Client Operations EN/HE key parity + no new hardcoded Hebrew UI chrome
 * in workspace tabs. User-data field interpolations and legal form IDs are
 * allowed; leftover chrome is an explicit remaining snapshot so new strings fail.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const en = JSON.parse(readFileSync(join(root, 'src/i18n/en.json'), 'utf8')) as Record<string, unknown>;
const he = JSON.parse(readFileSync(join(root, 'src/i18n/he.json'), 'utf8')) as Record<string, unknown>;

const SCAN_FILES = [
  'src/components/ClientDocumentsTab.tsx',
  'src/components/ClientHistoryTab.tsx',
  'src/components/ClientPayrollTab.tsx',
  'src/components/ClientBusinessProfileTab.tsx',
  'src/components/ClientTaxesTab.tsx',
  'src/components/ClientAccountingSettingsTab.tsx',
  'src/components/ClientFeesTab.tsx',
  'src/components/ClientAnnualReportTab.tsx',
  'src/components/ClientObligationsTab.tsx',
  'src/components/client-operations/ClientOperationsTodoBoardModal.tsx',
  'src/components/client-operations/ClientOperationsTodoCompleteModal.tsx',
  'src/components/client-operations/ClientOperationsTodoClientPicker.tsx',
  'src/components/client-operations/ClientOperationsTodoNotePopover.tsx',
  'src/components/client-operations/ClientOperationsClientQuickProfilePopover.tsx',
  'src/components/client-operations/ClientOperationsRegistryView.tsx',
  'src/components/client-operations/ClientOperationsMultiSelectFilter.tsx',
  'src/components/ClientNoteModal.tsx',
  'src/components/ClientWorkspacePanel.tsx',
  'src/components/client-workspace-profile-autosave.pure.ts',
  'src/components/client-operations/ClientOperationsPeriodSheetTabs.tsx',
] as const;

/** Remaining user-data field names — interpolations of these are not UI chrome. */
const USER_DATA_FIELD_NAMES = [
  'name_he',
  'body',
  'display_value',
  'file_name_he',
  'title_he',
  'label_he',
  'message_he',
  'status_label_he',
  'action_label_he',
  'request_text_he',
  'period_display_he',
  'due_date_display_he',
  'period_label_he',
  'monthly_amount_display_he',
  'payroll_period_display_he',
  'tab_title_he',
  'description_he',
  'document_name_he',
  'client_display_name',
  'display_name',
  'notes_cell_text_he',
] as const;

const LEGAL_IDS = ['102', '100', '126', 'PCN'];
const HEBREW_RE = /[\u0590-\u05FF]/;

/**
 * Snapshot of leftover Hebrew chrome still in other tabs (not Obligations).
 * New chrome outside this set fails the test. Obligations must stay empty.
 */
const KNOWN_REMAINING_CHROME = new Set<string>([]);

function collectKeys(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return prefix ? [prefix] : [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return prefix ? [prefix] : [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, (line, prefix: string) => prefix + ' '.repeat(Math.max(0, line.length - prefix.length)));
}

function normalizeSnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 140);
}

function fingerprint(file: string, kind: string, snippet: string): string {
  const base = file.replace(/\\/g, '/').split('/').pop() ?? file;
  return `${base}|${kind}|${normalizeSnippet(snippet)}`;
}

function isLegalIdOnly(text: string): boolean {
  const stripped = text.replace(/[0-9]/g, (d, _, s) => {
    void d;
    void s;
    return '';
  }).replace(/PCN/gi, '').replace(/[\s.,\-:/()]/g, '');
  return !HEBREW_RE.test(stripped) && LEGAL_IDS.some((id) => text.includes(id));
}

function isUserDataInterpolation(snippet: string): boolean {
  if (!HEBREW_RE.test(snippet)) return true;
  const quotedHebrew = [...snippet.matchAll(/(['"`])([^'"`]*[\u0590-\u05FF][^'"`]*)\1/g)].map((m) => m[2]);
  if (quotedHebrew.length === 0) {
    return USER_DATA_FIELD_NAMES.some((name) => snippet.includes(name));
  }
  return quotedHebrew.every((q) => isLegalIdOnly(q));
}

type Hit = { file: string; kind: string; line: number; snippet: string; fp: string };

function scanFile(rel: string): Hit[] {
  const src = stripComments(readFileSync(join(root, rel), 'utf8'));
  const hits: Hit[] = [];
  const add = (kind: string, text: string, index: number) => {
    const snippet = normalizeSnippet(text);
    hits.push({
      file: rel,
      kind,
      line: src.slice(0, index).split('\n').length,
      snippet,
      fp: fingerprint(rel, kind, snippet),
    });
  };
  for (const m of src.matchAll(/\bconfirm\s*\(\s*(['"`])((?:\\.|[^\\])*?)\1/g)) {
    if (HEBREW_RE.test(m[2] ?? '')) add('confirm', m[2] ?? '', m.index ?? 0);
  }
  for (const m of src.matchAll(/\b(title|aria-label|placeholder)\s*=\s*(['"`])((?:\\.|[^\\])*?)\2/g)) {
    if (HEBREW_RE.test(m[3] ?? '')) add(m[1] ?? 'attr', m[3] ?? '', m.index ?? 0);
  }
  for (const m of src.matchAll(/\b(title|aria-label|placeholder)\s*=\s*\{\s*(['"`])((?:\\.|[^\\])*?)\2/g)) {
    if (HEBREW_RE.test(m[3] ?? '')) add(m[1] ?? 'attr', m[3] ?? '', m.index ?? 0);
  }
  for (const m of src.matchAll(/>([^<>{}]*[\u0590-\u05FF][^<>{}]*)</g)) {
    add('jsx-text', m[1] ?? '', m.index ?? 0);
  }
  for (const m of src.matchAll(/>\s*\{([^}]*['"`][^'"`]*[\u0590-\u05FF][^'"`]*['"`][^}]*)\}/g)) {
    add('jsx-expr', m[1] ?? '', m.index ?? 0);
  }
  return hits;
}

test('clientOperations keys in en.json and he.json match', () => {
  const enKeys = collectKeys(en.clientOperations).sort();
  const heKeys = collectKeys(he.clientOperations).sort();
  assert.deepEqual(heKeys, enKeys);
  assert.ok(enKeys.includes('obligations.title'));
  assert.ok(enKeys.includes('obligations.sendDataRequest'));
  assert.ok(enKeys.includes('save'));
  assert.ok(enKeys.includes('close'));
  assert.ok(enKeys.includes('taxes.cards.niSelfEmployed'));
  assert.ok(enKeys.includes('fees.tooltipWas'));
  assert.ok(enKeys.includes('history.summaries.feeAgreementUpdated'));
  assert.ok(enKeys.includes('history.subjects.vat'));
});

test('Client Operations tabs have no new hardcoded Hebrew UI chrome', () => {
  const unexpected: string[] = [];
  const obligationsHits: Hit[] = [];
  for (const file of SCAN_FILES) {
    const fileHits = scanFile(file);
    for (const hit of fileHits) {
      if (isLegalIdOnly(hit.snippet) || isUserDataInterpolation(hit.snippet)) continue;
      if (file.endsWith('ClientObligationsTab.tsx')) {
        obligationsHits.push(hit);
        continue;
      }
      if (!KNOWN_REMAINING_CHROME.has(hit.fp)) {
        unexpected.push(`${hit.fp} (L${hit.line})`);
      }
    }
  }
  assert.deepEqual(
    obligationsHits.map((h) => h.fp),
    [],
    `ClientObligationsTab still has hardcoded Hebrew chrome: ${obligationsHits.map((h) => h.fp).join('; ')}`,
  );
  assert.deepEqual(unexpected, [], `new hardcoded Hebrew UI chrome:\n${unexpected.join('\n')}`);
});
