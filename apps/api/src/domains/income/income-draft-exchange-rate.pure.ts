/**
 * Income wizard draft FX — types + merge official BOI rate with user override.
 */

import type { BoiOfficialRate } from './income-boi-exchange-rate.pure.js';
import { boiSourceLabel, formatBoiRateDisplay, normalizeIsoDate } from './income-boi-exchange-rate.pure.js';

export type IncomeDraftLineCurrency = 'ILS' | 'USD' | 'EUR' | 'GBP';

export const INCOME_DRAFT_ALLOWED_CURRENCIES: readonly IncomeDraftLineCurrency[] = [
  'ILS',
  'USD',
  'EUR',
  'GBP',
] as const;

const CURRENCY_LABELS: Record<IncomeDraftLineCurrency, string> = {
  ILS: '₪',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

export type DraftExchangeRateResolution = {
  currency: IncomeDraftLineCurrency;
  rate_to_ils: number;
  rate_display: string;
  rate_official: number | null;
  rate_official_display: string | null;
  exchange_rate_date: string;
  source_label: string;
  source: 'ils' | 'boi_exact' | 'boi_previous' | 'override';
};

const CURRENCY_ALIASES: Record<string, IncomeDraftLineCurrency> = {
  '₪': 'ILS',
  NIS: 'ILS',
  'ש"ח': 'ILS',
  'ש״ח': 'ILS',
};

export function isAllowedDraftLineCurrency(code: string): code is IncomeDraftLineCurrency {
  return (INCOME_DRAFT_ALLOWED_CURRENCIES as readonly string[]).includes(code);
}

function resolveCurrencyCode(trimmed: string): IncomeDraftLineCurrency | null {
  const alias = CURRENCY_ALIASES[trimmed] ?? CURRENCY_ALIASES[trimmed.toUpperCase()];
  if (alias) return alias;
  const code = trimmed.toUpperCase();
  if (isAllowedDraftLineCurrency(code)) return code;
  return null;
}

export function parseDraftLineCurrency(raw: unknown): IncomeDraftLineCurrency {
  const trimmed = String(raw ?? 'ILS').trim();
  return resolveCurrencyCode(trimmed) ?? 'ILS';
}

export function parseDraftLineCurrencyFromPatch(raw: unknown): IncomeDraftLineCurrency {
  const trimmed = String(raw ?? '').trim();
  const resolved = resolveCurrencyCode(trimmed);
  if (!resolved) {
    throw new Error('DRAFT_LINE_CURRENCY_INVALID');
  }
  return resolved;
}

export const DRAFT_LINE_CURRENCY_INVALID_MESSAGE = 'מטבע לא נתמך';

export function parseDraftLineExchangeRateOverride(
  currency: IncomeDraftLineCurrency,
  raw: unknown,
): number | null {
  if (currency === 'ILS') return null;
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('DRAFT_LINE_EXCHANGE_RATE_INVALID');
  }
  return n;
}

export const DRAFT_LINE_EXCHANGE_RATE_INVALID_MESSAGE =
  'שער חליפין חייב להיות מספר חיובי (למטבע זר בלבד)';

export function draftCurrencyLabel(code: IncomeDraftLineCurrency): string {
  return CURRENCY_LABELS[code] ?? code;
}

export function allowedCurrencyOptions(): { value: IncomeDraftLineCurrency; label: string }[] {
  return INCOME_DRAFT_ALLOWED_CURRENCIES.map((value) => ({
    value,
    label: draftCurrencyLabel(value),
  }));
}

export function buildDraftExchangeRateResolution(
  currency: IncomeDraftLineCurrency,
  documentDate: string,
  official: BoiOfficialRate | null,
  override: number | null,
): DraftExchangeRateResolution | null {
  const requested = normalizeIsoDate(documentDate);

  if (currency === 'ILS') {
    return {
      currency,
      rate_to_ils: 1,
      rate_display: '1.0000',
      rate_official: 1,
      rate_official_display: '1.0000',
      exchange_rate_date: requested,
      source_label: 'שקל — ללא המרה',
      source: 'ils',
    };
  }

  if (override != null && Number.isFinite(override) && override > 0) {
    return {
      currency,
      rate_to_ils: override,
      rate_display: formatBoiRateDisplay(override),
      rate_official: official?.rate_to_ils ?? null,
      rate_official_display: official?.rate_display ?? null,
      exchange_rate_date: official?.rate_date ?? requested,
      source_label: 'שער מותאם',
      source: 'override',
    };
  }

  if (!official) return null;

  return {
    currency,
    rate_to_ils: official.rate_to_ils,
    rate_display: official.rate_display,
    rate_official: official.rate_to_ils,
    rate_official_display: official.rate_display,
    exchange_rate_date: official.rate_date,
    source_label: boiSourceLabel(
      official.exact_date_match,
      official.rate_date,
      official.requested_date,
    ),
    source: official.exact_date_match ? 'boi_exact' : 'boi_previous',
  };
}

/** @deprecated use buildDraftExchangeRateResolution — sync stub for legacy callers in tests */
export function resolveDraftExchangeRateToIls(
  currency: IncomeDraftLineCurrency,
  documentDate: string,
  override: number | null,
  official?: BoiOfficialRate | null,
): DraftExchangeRateResolution | null {
  return buildDraftExchangeRateResolution(currency, documentDate, official ?? null, override);
}
