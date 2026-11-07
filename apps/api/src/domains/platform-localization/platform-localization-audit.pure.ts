/**
 * Backend-owned localization audit for Owner Languages.
 * Confirmed system-label issues only — not user data, not “no owner override”.
 */

import { moduleGroupForKey } from './platform-localization.pure.js';

const HEBREW_RE = /[\u0590-\u05FF]/;
const LATIN_WORD_RE = /[A-Za-z]{3,}/;

const ALLOWED_EXACT = new Set([
  'DocFlow',
  'Nodex',
  'NodexPro',
  'Nodex Pro',
  'PCN',
  'VAT',
  'ID',
  'SLA',
  'ILS',
  'USD',
  'EUR',
  'PDF',
  'CSV',
  'HP',
  'MFA',
  'API',
  'SMS',
  'OTP',
  'OK',
  'MM/YY',
  'NI',
  'IT',
  'עברית',
  'English',
]);

export type LocalizationIssueKind =
  | 'missing_translation'
  | 'wrong_language_system_text'
  | 'hardcoded_unconnected'
  | 'direction_issue'
  | 'placeholder_mismatch'
  | 'needs_review';

export type TranslationValueOrigin = 'owner_published' | 'owner_draft' | 'bundled' | 'empty';

export type LocalizationEmptyExplanation =
  | 'no_owner_override'
  | 'no_bundled_translation'
  | 'placeholder_mismatch'
  | null;

export type LocalizationAuditEntry = {
  key: string;
  module_group: string;
  source_en: string;
  owner_value: string;
  owner_status: string;
  bundled_value: string;
  live_value: string;
  value_origin: TranslationValueOrigin;
  empty_explanation: LocalizationEmptyExplanation;
  placeholder_ok: boolean;
};

export type HardcodedSurface = {
  id: string;
  tab: string;
  location: string;
  displayed_text: string;
  localization_key: string | null;
  requires_code_fix: boolean;
  reason: string;
  target_locales: string[];
  usage_locations?: Array<{ tab: string; location: string }>;
};

export type LocalizationIssueCard = {
  id: string;
  kind: LocalizationIssueKind;
  module_group: string;
  tab: string;
  location: string;
  localization_key: string | null;
  current_displayed_text: string;
  source_language: 'en' | 'he' | 'mixed' | 'unknown';
  target_language: string;
  published_value: string | null;
  bundled_value: string | null;
  draft_value: string | null;
  value_origin: TranslationValueOrigin | 'hardcoded';
  empty_explanation: LocalizationEmptyExplanation;
  reason: string;
  requires_code_fix: boolean;
  usage_locations: Array<{ tab: string; location: string }>;
  placeholder_ok: boolean;
  editable: boolean;
};

export type LocalizationAudit = {
  selected_module: string;
  selected_locale: string;
  target_direction: 'ltr' | 'rtl';
  catalog_size: number;
  live_translated_count: number;
  owner_override_count: number;
  bundled_only_count: number;
  empty_live_count: number;
  confirmed_issue_count: number;
  by_kind: Record<LocalizationIssueKind, number>;
  tabs: string[];
  issues: LocalizationIssueCard[];
  unverified_surfaces: Array<{ tab: string; reason: string }>;
};

const CO_TAB_PREFIXES: Array<{ prefix: string; tab: string; location: string }> = [
  { prefix: 'clientOperations.registry', tab: 'Registry', location: 'Spreadsheet columns, filters, toolbar' },
  { prefix: 'clientOperations.search', tab: 'Registry', location: 'Search' },
  { prefix: 'clientOperations.todo', tab: 'ToDo List', location: 'Board, archive, complete dialog' },
  { prefix: 'clientOperations.taxes', tab: 'Taxes', location: 'Tax cards, modals, statuses' },
  { prefix: 'clientOperations.fees', tab: 'Fees', location: 'Fee agreement and chart' },
  { prefix: 'clientOperations.payroll', tab: 'Payroll', location: 'Payroll tab' },
  { prefix: 'clientOperations.salary', tab: 'Payroll', location: 'Payroll tab' },
  { prefix: 'clientOperations.documents', tab: 'Documents', location: 'Documents tab and upload dialogs' },
  { prefix: 'clientOperations.annual', tab: 'Annual report', location: 'Annual report tab' },
  { prefix: 'clientOperations.equity', tab: 'Capital declaration', location: 'Capital declaration tab' },
  { prefix: 'clientOperations.history', tab: 'History', location: 'History tab' },
  { prefix: 'clientOperations.obligations', tab: 'Obligations', location: 'Obligations table and actions' },
  { prefix: 'clientOperations.accounting', tab: 'Accounting settings', location: 'Accounting settings cards and modals' },
  { prefix: 'clientOperations.docflow', tab: 'Client details', location: 'DocFlow workspace tab' },
  { prefix: 'clientOperations.notes', tab: 'Client details', location: 'Notes and reminders' },
  { prefix: 'clientOperations.fields', tab: 'Client details', location: 'Profile fields' },
  { prefix: 'clientOperations.profile', tab: 'Client details', location: 'Profile autosave' },
  { prefix: 'clientOperations.status', tab: 'Client details', location: 'Client status' },
  { prefix: 'clientOperations.businessType', tab: 'Client details', location: 'Business type' },
  { prefix: 'clientOperations.tabs', tab: 'Client details', location: 'Workspace tab labels' },
  { prefix: 'clientOperations.quickProfile', tab: 'Registry', location: 'Quick profile popover' },
  { prefix: 'clientOperations.reminders', tab: 'Registry', location: 'Reminder toasts' },
  { prefix: 'clientOperations.workspace', tab: 'Client details', location: 'Workspace chrome' },
  { prefix: 'clientOperations.enums', tab: 'Registry', location: 'System enum display' },
  { prefix: 'clientOperations.colors', tab: 'Registry', location: 'Text color palette' },
  { prefix: 'nav.clientOperations', tab: 'Registry', location: 'Module navigation' },
  { prefix: 'clientOperations.clientsBrand', tab: 'Registry', location: 'Module navigation' },
  { prefix: 'clientOperations.moduleTitle', tab: 'Registry', location: 'Module header' },
];

/** Remaining unconnected chrome that still renders in Client Operations after connected-key fixes. */
export const CLIENT_OPERATIONS_HARDCODED_SURFACES: HardcodedSurface[] = [];

export const CLIENT_OPERATIONS_UNVERIFIED_SURFACES: Array<{ tab: string; reason: string }> = [
  {
    tab: 'Accounting settings',
    reason:
      'Legacy ClientAccountingTab is fully hardcoded Hebrew but is not mounted; live Accounting settings uses ClientAccountingSettingsTab.',
  },
  {
    tab: 'Client details / DocFlow empty and error states',
    reason: 'Office DocFlow threads and attachments need an authenticated client case; keys are wired, live messages were not exercised here.',
  },
];

export function textHasHebrew(value: string): boolean {
  return HEBREW_RE.test(value);
}

export function textHasLatinWord(value: string): boolean {
  return LATIN_WORD_RE.test(value);
}

export function detectScriptLanguage(value: string): 'en' | 'he' | 'mixed' | 'unknown' {
  const he = textHasHebrew(value);
  const en = textHasLatinWord(value);
  if (he && en) return 'mixed';
  if (he) return 'he';
  if (en) return 'en';
  return 'unknown';
}

export function isAllowedException(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (ALLOWED_EXACT.has(trimmed)) return true;
  if (/^[A-Z]{2,5}$/.test(trimmed)) return true;
  if (/^[A-Za-z0-9][A-Za-z0-9 .,'’+\-/]*\s*\([^)]*[\u0590-\u05FF][^)]*\)$/.test(trimmed)) return true;
  if (/^Nodex(\s+Pro)?(\s+clients)?$/i.test(trimmed)) return true;
  return false;
}

export function isWrongLanguageSystemText(value: string, locale: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || isAllowedException(trimmed)) return false;
  if (locale === 'en') {
    if (!textHasHebrew(trimmed)) return false;
    if (/^[A-Za-z0-9][A-Za-z0-9 .,'’+\-/]*\s*\([^)]*[\u0590-\u05FF][^)]*\)$/.test(trimmed)) return false;
    return true;
  }
  if (locale === 'he') {
    if (textHasHebrew(trimmed)) return false;
    if (!textHasLatinWord(trimmed)) return false;
    return true;
  }
  return false;
}

export function overlayValueAllowedForLocale(value: string, locale: string): boolean {
  return !isWrongLanguageSystemText(value, locale);
}

export function translationValueOrigin(input: {
  ownerValue: string;
  ownerStatus: string;
  bundledValue: string;
}): TranslationValueOrigin {
  if (input.ownerValue.trim()) {
    return input.ownerStatus === 'published' ? 'owner_published' : 'owner_draft';
  }
  if (input.bundledValue.trim()) return 'bundled';
  return 'empty';
}

export function translationEmptyExplanation(input: {
  ownerValue: string;
  bundledValue: string;
  placeholderOk: boolean;
}): LocalizationEmptyExplanation {
  if (input.ownerValue.trim() && !input.placeholderOk) return 'placeholder_mismatch';
  if (input.ownerValue.trim()) return null;
  if (input.bundledValue.trim()) return 'no_owner_override';
  return 'no_bundled_translation';
}

export function liveDisplayValue(input: {
  ownerValue: string;
  ownerStatus: string;
  bundledValue: string;
}): string {
  if (input.ownerStatus === 'published' && input.ownerValue.trim()) return input.ownerValue;
  return input.bundledValue;
}

export function clientOperationsSurfaceForKey(key: string): { tab: string; location: string } {
  for (const row of CO_TAB_PREFIXES) {
    if (key === row.prefix || key.startsWith(`${row.prefix}.`) || key.startsWith(row.prefix)) {
      return { tab: row.tab, location: row.location };
    }
  }
  if (key.startsWith('clientOperations.')) {
    return { tab: 'Client Operations', location: key };
  }
  return { tab: moduleGroupForKey(key), location: key };
}

function emptyKindCounts(): Record<LocalizationIssueKind, number> {
  return {
    missing_translation: 0,
    wrong_language_system_text: 0,
    hardcoded_unconnected: 0,
    direction_issue: 0,
    placeholder_mismatch: 0,
    needs_review: 0,
  };
}

export function buildModuleLocalizationAudit(input: {
  locale: string;
  direction: 'ltr' | 'rtl';
  moduleGroup: string;
  entries: LocalizationAuditEntry[];
  hardcodedSurfaces?: HardcodedSurface[];
  unverifiedSurfaces?: Array<{ tab: string; reason: string }>;
}): LocalizationAudit {
  const issues: LocalizationIssueCard[] = [];
  const byKind = emptyKindCounts();
  const tabs = new Set<string>();
  const moduleEntries = input.entries.filter((entry) =>
    input.moduleGroup === 'all' ? true : entry.module_group === input.moduleGroup,
  );

  for (const entry of moduleEntries) {
    const surface = clientOperationsSurfaceForKey(entry.key);
    tabs.add(surface.tab);
    const usage = [surface];
    const publishedValue = entry.owner_status === 'published' && entry.owner_value.trim() ? entry.owner_value : null;
    const draftValue = entry.owner_status !== 'published' && entry.owner_value.trim() ? entry.owner_value : null;

    if (!entry.live_value.trim()) {
      const card: LocalizationIssueCard = {
        id: `missing:${entry.key}`,
        kind: 'missing_translation',
        module_group: entry.module_group,
        tab: surface.tab,
        location: surface.location,
        localization_key: entry.key,
        current_displayed_text: '',
        source_language: 'en',
        target_language: input.locale,
        published_value: publishedValue,
        bundled_value: entry.bundled_value || null,
        draft_value: draftValue,
        value_origin: entry.value_origin,
        empty_explanation: entry.empty_explanation ?? 'no_bundled_translation',
        reason: 'No bundled translation and no published Owner override, so the UI has nothing to render for this system label.',
        requires_code_fix: false,
        usage_locations: usage,
        placeholder_ok: entry.placeholder_ok,
        editable: true,
      };
      issues.push(card);
      byKind.missing_translation += 1;
      continue;
    }

    if (entry.owner_value.trim() && !entry.placeholder_ok) {
      issues.push({
        id: `placeholder:${entry.key}`,
        kind: 'placeholder_mismatch',
        module_group: entry.module_group,
        tab: surface.tab,
        location: surface.location,
        localization_key: entry.key,
        current_displayed_text: entry.live_value,
        source_language: detectScriptLanguage(entry.source_en),
        target_language: input.locale,
        published_value: publishedValue,
        bundled_value: entry.bundled_value || null,
        draft_value: draftValue,
        value_origin: entry.value_origin,
        empty_explanation: 'placeholder_mismatch',
        reason: 'Owner translation placeholders do not match the English source. Publish is blocked until this is fixed.',
        requires_code_fix: false,
        usage_locations: usage,
        placeholder_ok: false,
        editable: true,
      });
      byKind.placeholder_mismatch += 1;
    }

    if (isWrongLanguageSystemText(entry.live_value, input.locale)) {
      issues.push({
        id: `wrong-lang:${entry.key}`,
        kind: 'wrong_language_system_text',
        module_group: entry.module_group,
        tab: surface.tab,
        location: surface.location,
        localization_key: entry.key,
        current_displayed_text: entry.live_value,
        source_language: detectScriptLanguage(entry.live_value),
        target_language: input.locale,
        published_value: publishedValue,
        bundled_value: entry.bundled_value || null,
        draft_value: draftValue,
        value_origin: entry.value_origin,
        empty_explanation: entry.empty_explanation,
        reason:
          input.locale === 'en'
            ? 'Live English UI would show Hebrew system text from a published Owner override or fallback.'
            : 'Live Hebrew UI would show untranslated English system text.',
        requires_code_fix: false,
        usage_locations: usage,
        placeholder_ok: entry.placeholder_ok,
        editable: true,
      });
      byKind.wrong_language_system_text += 1;
    } else if (
      detectScriptLanguage(entry.live_value) === 'mixed' &&
      !isAllowedException(entry.live_value) &&
      !/^[A-Za-z0-9].*\(.*[\u0590-\u05FF].*\)$/.test(entry.live_value.trim())
    ) {
      issues.push({
        id: `review:${entry.key}`,
        kind: 'needs_review',
        module_group: entry.module_group,
        tab: surface.tab,
        location: surface.location,
        localization_key: entry.key,
        current_displayed_text: entry.live_value,
        source_language: 'mixed',
        target_language: input.locale,
        published_value: publishedValue,
        bundled_value: entry.bundled_value || null,
        draft_value: draftValue,
        value_origin: entry.value_origin,
        empty_explanation: entry.empty_explanation,
        reason: 'Mixed-script system text that is not an allowed brand, abbreviation, or legal gloss.',
        requires_code_fix: false,
        usage_locations: usage,
        placeholder_ok: entry.placeholder_ok,
        editable: true,
      });
      byKind.needs_review += 1;
    }

  }

  if (input.locale === 'he' && input.direction !== 'rtl') {
    issues.push({
      id: 'dir:he',
      kind: 'direction_issue',
      module_group: input.moduleGroup,
      tab: 'All Client Operations',
      location: 'document.dir / language record',
      localization_key: null,
      current_displayed_text: input.direction,
      source_language: 'he',
      target_language: input.locale,
      published_value: null,
      bundled_value: null,
      draft_value: null,
      value_origin: 'hardcoded',
      empty_explanation: null,
      reason: 'Hebrew locale is not marked RTL on the language record.',
      requires_code_fix: false,
      usage_locations: [{ tab: 'All Client Operations', location: 'Language direction' }],
      placeholder_ok: true,
      editable: false,
    });
    byKind.direction_issue += 1;
  }

  const hardcoded = (input.hardcodedSurfaces ?? CLIENT_OPERATIONS_HARDCODED_SURFACES).filter((row) =>
    row.target_locales.includes(input.locale),
  );
  for (const surface of hardcoded) {
    if (input.moduleGroup !== 'all' && input.moduleGroup !== 'clientOperations') continue;
    issues.push({
      id: `hardcoded:${surface.id}`,
      kind: 'hardcoded_unconnected',
      module_group: 'clientOperations',
      tab: surface.tab,
      location: surface.location,
      localization_key: surface.localization_key,
      current_displayed_text: surface.displayed_text,
      source_language: detectScriptLanguage(surface.displayed_text),
      target_language: input.locale,
      published_value: null,
      bundled_value: null,
      draft_value: null,
      value_origin: 'hardcoded',
      empty_explanation: null,
      reason: surface.reason,
      requires_code_fix: surface.requires_code_fix,
      usage_locations: surface.usage_locations ?? [{ tab: surface.tab, location: surface.location }],
      placeholder_ok: true,
      editable: false,
    });
    byKind.hardcoded_unconnected += 1;
    tabs.add(surface.tab);
  }

  const liveTranslatedCount = moduleEntries.filter((entry) => entry.live_value.trim()).length;
  const ownerOverrideCount = moduleEntries.filter((entry) => entry.owner_value.trim()).length;
  const bundledOnlyCount = moduleEntries.filter((entry) => entry.value_origin === 'bundled').length;
  const emptyLiveCount = moduleEntries.filter((entry) => !entry.live_value.trim()).length;

  return {
    selected_module: input.moduleGroup,
    selected_locale: input.locale,
    target_direction: input.direction,
    catalog_size: moduleEntries.length,
    live_translated_count: liveTranslatedCount,
    owner_override_count: ownerOverrideCount,
    bundled_only_count: bundledOnlyCount,
    empty_live_count: emptyLiveCount,
    confirmed_issue_count: issues.length,
    by_kind: byKind,
    tabs: [...tabs].sort((a, b) => a.localeCompare(b)),
    issues,
    unverified_surfaces:
      input.moduleGroup === 'clientOperations' || input.moduleGroup === 'all'
        ? (input.unverifiedSurfaces ?? CLIENT_OPERATIONS_UNVERIFIED_SURFACES)
        : [],
  };
}
