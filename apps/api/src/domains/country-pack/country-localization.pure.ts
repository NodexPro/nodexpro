import { badRequest } from '../../shared/errors.js';

/** Selectable locales for owner country configuration. Not a country→language map. */
export const OWNER_COUNTRY_LOCALE_CATALOG = [
  { code: 'en', label: 'English' },
  { code: 'he', label: 'עברית' },
  { code: 'fr', label: 'Français' },
  { code: 'lv', label: 'Latviešu' },
] as const;

const LOCALE_RE = /^[a-z]{2}(-[a-z]{2})?$/;

export function normalizeCountryLocale(value: unknown, field = 'locale'): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`${field} is required`);
  }
  const locale = value.trim().toLowerCase();
  if (!LOCALE_RE.test(locale)) {
    throw badRequest(`${field} must be xx or xx-yy`);
  }
  return locale;
}

export function optionalCountryLocale(value: unknown, field = 'locale'): string | null {
  if (value === undefined || value === null || value === '') return null;
  return normalizeCountryLocale(value, field);
}

export function uniqueCountryLocales(values: unknown, field = 'supported_locales'): string[] {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) throw badRequest(`${field} must be an array`);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const locale = normalizeCountryLocale(value, field);
    if (seen.has(locale)) continue;
    seen.add(locale);
    out.push(locale);
  }
  return out;
}

export function normalizeCountryLocalization(input: {
  default_locale?: unknown;
  supported_locales?: unknown;
  required?: boolean;
}): { default_locale: string | null; supported_locales: string[] } {
  const defaultLocale = input.required
    ? normalizeCountryLocale(input.default_locale, 'default_locale')
    : optionalCountryLocale(input.default_locale, 'default_locale');
  let supported = uniqueCountryLocales(input.supported_locales, 'supported_locales');
  if (defaultLocale && !supported.length) supported = [defaultLocale];
  if (defaultLocale && !supported.includes(defaultLocale)) {
    throw badRequest('default_locale must be included in supported_locales');
  }
  if (input.required && !supported.length) {
    throw badRequest('supported_locales is required');
  }
  return { default_locale: defaultLocale, supported_locales: supported };
}

export function pickPresentationForLocale<T extends { locale: string }>(
  presentations: T[],
  defaultLocale: string | null | undefined,
): T | null {
  if (!presentations.length) return null;
  const loc = typeof defaultLocale === 'string' ? defaultLocale.trim().toLowerCase() : '';
  const lang = loc.slice(0, 2);
  if (loc) {
    const exact = presentations.find((row) => row.locale === loc);
    if (exact) return exact;
    if (lang) {
      const prefix = presentations.find((row) => row.locale === lang || row.locale.startsWith(`${lang}-`));
      if (prefix) return prefix;
    }
  }
  if (presentations.length === 1) return presentations[0];
  return null;
}
