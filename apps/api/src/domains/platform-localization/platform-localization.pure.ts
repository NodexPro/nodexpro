export const DATE_FORMAT_OPTIONS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;
export type DateFormatCode = (typeof DATE_FORMAT_OPTIONS)[number];

export const DISPLAY_TIMEZONE_OPTIONS = [
  'Asia/Jerusalem',
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Africa/Cairo',
  'Australia/Sydney',
] as const;

export type CurrencyStatus = 'draft' | 'published' | 'inactive';
export type LanguageStatus = 'draft' | 'review' | 'published';
export type TranslationEntryStatus = 'draft' | 'review' | 'published';
export type TextDirection = 'ltr' | 'rtl';

const ISO_4217 = /^[A-Z]{3}$/;
const LOCALE = /^[a-z]{2}(-[A-Z]{2})?$/;
const IANA_TZ = /^[A-Za-z]+(?:[_/+-][A-Za-z0-9]+)+$|^UTC$/;
const PLACEHOLDER_RE = /(\{\{[^}]+\}\}|\{[a-zA-Z0-9_]+\})/g;

export function isIso4217Code(code: string): boolean {
  return ISO_4217.test(code.trim());
}

export function normalizeCurrencyCode(code: string): string {
  return code.trim().toUpperCase();
}

export function isLocaleCode(code: string): boolean {
  return LOCALE.test(code.trim());
}

export function isIanaTimeZone(value: string): boolean {
  const tz = value.trim();
  if (tz === 'UTC') return true;
  if (!IANA_TZ.test(tz)) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function isDateFormatCode(value: string): value is DateFormatCode {
  return (DATE_FORMAT_OPTIONS as readonly string[]).includes(value);
}

export function extractPlaceholders(text: string): string[] {
  return [...(text.match(PLACEHOLDER_RE) ?? [])].sort();
}

export function placeholdersMatch(source: string, target: string): boolean {
  const a = extractPlaceholders(source);
  const b = extractPlaceholders(target);
  if (a.length !== b.length) return false;
  return a.every((item, i) => item === b[i]);
}

export function flattenMessageTree(
  node: unknown,
  prefix = '',
  out: Record<string, string> = {},
): Record<string, string> {
  if (typeof node === 'string') {
    if (prefix) out[prefix] = node;
    return out;
  }
  if (!node || typeof node !== 'object' || Array.isArray(node)) return out;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${key}` : key;
    flattenMessageTree(value, next, out);
  }
  return out;
}

export function moduleGroupForKey(key: string): string {
  const group = key.split('.')[0]?.trim();
  return group || 'general';
}

export function translationCompleteness(input: {
  catalogSize: number;
  translatedCount: number;
}): { ratio: number; complete: boolean } {
  const catalogSize = Math.max(0, input.catalogSize);
  const translatedCount = Math.max(0, input.translatedCount);
  if (catalogSize === 0) return { ratio: 0, complete: false };
  const ratio = Math.min(1, translatedCount / catalogSize);
  return { ratio: Number(ratio.toFixed(4)), complete: translatedCount >= catalogSize };
}

export function canPublishLanguage(input: {
  catalogSize: number;
  translatedCount: number;
  placeholderFailures: number;
}): { ok: true } | { ok: false; code: string; message: string } {
  if (input.placeholderFailures > 0) {
    return {
      ok: false,
      code: 'PLACEHOLDER_MISMATCH',
      message: 'Fix placeholder mismatches before publishing this language.',
    };
  }
  const completeness = translationCompleteness(input);
  if (!completeness.complete) {
    return {
      ok: false,
      code: 'INCOMPLETE_TRANSLATION',
      message: 'Do not publish an incomplete language as fully supported.',
    };
  }
  return { ok: true };
}

export function publishedCurrencyOptions(
  rows: Array<{ code: string; name_en: string; symbol: string; status: string }>,
): Array<{ code: string; label: string; symbol: string }> {
  return rows
    .filter((row) => row.status === 'published')
    .map((row) => ({
      code: row.code,
      symbol: row.symbol,
      label: `${row.code} — ${row.symbol} ${row.name_en}`.trim(),
    }));
}

export function publishedLanguageOptions(
  rows: Array<{ locale_code: string; name: string; direction: string; status: string }>,
): Array<{ locale: string; name: string; direction: TextDirection }> {
  return rows
    .filter((row) => row.status === 'published')
    .map((row) => ({
      locale: row.locale_code,
      name: row.name,
      direction: row.direction === 'rtl' ? 'rtl' : 'ltr',
    }));
}

export function timezoneOptions(orgTimezone: string | null): Array<{ value: string; label: string }> {
  const values = new Set<string>(DISPLAY_TIMEZONE_OPTIONS);
  if (orgTimezone && isIanaTimeZone(orgTimezone)) values.add(orgTimezone);
  return [...values].map((value) => ({ value, label: value }));
}

export function validateLocalizationPreferences(input: {
  languageCode: string;
  timezone: string;
  dateFormat: string;
  displayCurrencyCode: string;
  publishedLanguageLocales: string[];
  publishedCurrencyCodes: string[];
}): { ok: true } | { ok: false; code: string; message: string } {
  if (!input.publishedLanguageLocales.includes(input.languageCode)) {
    return { ok: false, code: 'LANGUAGE_NOT_PUBLISHED', message: 'Select a published interface language.' };
  }
  if (!isIanaTimeZone(input.timezone)) {
    return { ok: false, code: 'INVALID_TIMEZONE', message: 'Select a valid IANA time zone.' };
  }
  if (!isDateFormatCode(input.dateFormat)) {
    return { ok: false, code: 'INVALID_DATE_FORMAT', message: 'Select a supported date format.' };
  }
  const currency = normalizeCurrencyCode(input.displayCurrencyCode);
  if (!input.publishedCurrencyCodes.includes(currency)) {
    return {
      ok: false,
      code: 'CURRENCY_NOT_PUBLISHED',
      message: 'Select a published display currency. This does not change accounting base currency.',
    };
  }
  return { ok: true };
}
