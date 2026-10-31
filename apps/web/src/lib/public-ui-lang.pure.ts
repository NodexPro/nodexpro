export const PUBLIC_UI_LANGS = ['en', 'he'] as const;
export type PublicUiLang = (typeof PUBLIC_UI_LANGS)[number];

export const PUBLIC_LANG_STORAGE_KEY = 'lang';
export const PUBLIC_LANG_COOKIE = 'nx-lang';
export const PUBLIC_GEO_COUNTRY_COOKIE = 'nx-geo-country';

export function parseCookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  const source = String(cookieHeader ?? '');
  if (!source || !name) return null;
  const parts = source.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const raw = trimmed.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export function isStoredUiLang(value: string | null | undefined): value is 'en' | 'he' | 'ru' {
  return value === 'en' || value === 'he' || value === 'ru';
}

/**
 * Public first-visit language:
 * 1. explicit / stored preference
 * 2. trusted geo country (IL → he)
 * 3. English
 *
 * Browser language and timezone are not geo signals.
 */
export function resolvePublicUiLang(input: {
  stored?: string | null;
  geoCountry?: string | null;
}): 'en' | 'he' | 'ru' {
  if (isStoredUiLang(input.stored)) return input.stored;
  const country = String(input.geoCountry ?? '')
    .trim()
    .toUpperCase();
  if (country === 'IL') return 'he';
  return 'en';
}

export function buildLangCookie(lang: string): string {
  return `${PUBLIC_LANG_COOKIE}=${encodeURIComponent(lang)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function localizeOrFallback(
  t: (key: string) => string,
  key: string,
  fallback: string,
): string {
  const localized = t(key);
  return !localized || localized === key ? fallback : localized;
}

export function localizeLineList(
  t: (key: string) => string,
  baseKey: string,
  lines: string[],
): string[] {
  return lines.map((line, index) => localizeOrFallback(t, `${baseKey}.${index}`, line));
}

export function formatLandingPriceDisplay(input: {
  amount: number;
  currency: string;
  billingPeriod: string;
  locale: string;
  periodLabel: string;
}): string {
  let money: string;
  try {
    const locale = input.locale === 'he' ? 'he-IL' : input.locale === 'ru' ? 'ru-RU' : 'en-US';
    money = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: input.currency,
      minimumFractionDigits: Number.isInteger(input.amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(input.amount);
  } catch {
    money = `${input.amount} ${input.currency}`;
  }
  return `${money} / ${input.periodLabel}`;
}

export function formatLandingTrialLabel(
  months: number,
  t: (key: string) => string,
): string {
  if (months <= 0) return '';
  const key = months === 1 ? 'landing.trial.oneMonth' : 'landing.trial.months';
  return t(key).replace('{n}', String(months));
}
