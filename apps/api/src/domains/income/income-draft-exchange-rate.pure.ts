/**
 * Income wizard draft FX — backend-owned preview rates (not Accounting Base truth).
 * TEMPORARY_DRAFT_FX_PENDING: replace with Country Pack / official rate feed when available.
 */

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

/** IL preview fallbacks — updated when legal/official feed is wired. */
const IL_DRAFT_FX_FALLBACK_TO_ILS: Record<Exclude<IncomeDraftLineCurrency, 'ILS'>, number> = {
  USD: 3.65,
  EUR: 4.0,
  GBP: 4.65,
};

export type DraftExchangeRateResolution = {
  currency: IncomeDraftLineCurrency;
  rate_to_ils: number;
  rate_display: string;
  source_label: string;
  source: 'fallback_il' | 'override';
  as_of_date: string;
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

/** Normalize stored/UI currency (₪ → ILS); unknown values default to ILS. */
export function parseDraftLineCurrency(raw: unknown): IncomeDraftLineCurrency {
  const trimmed = String(raw ?? 'ILS').trim();
  return resolveCurrencyCode(trimmed) ?? 'ILS';
}

/** Strict currency from command patch — throws when not supported. */
export function parseDraftLineCurrencyFromPatch(raw: unknown): IncomeDraftLineCurrency {
  const trimmed = String(raw ?? '').trim();
  const resolved = resolveCurrencyCode(trimmed);
  if (!resolved) {
    throw new Error('DRAFT_LINE_CURRENCY_INVALID');
  }
  return resolved;
}

export const DRAFT_LINE_CURRENCY_INVALID_MESSAGE = 'מטבע לא נתמך';

/**
 * Parse optional user override. ILS always null (rate 1). Non-ILS: null = use backend default.
 * Throws only when user supplied an explicit non-positive rate.
 */
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

function formatRateDisplay(rate: number): string {
  return rate.toFixed(4);
}

/** Default exchange rate to ILS for draft preview (1 unit foreign → ILS). */
export function resolveDraftExchangeRateToIls(
  currency: IncomeDraftLineCurrency,
  documentDate: string,
  override: number | null,
): DraftExchangeRateResolution {
  const as_of_date = documentDate.trim() || new Date().toISOString().slice(0, 10);
  if (currency === 'ILS') {
    return {
      currency,
      rate_to_ils: 1,
      rate_display: '1.0000',
      source_label: 'שקל — ללא המרה',
      source: 'fallback_il',
      as_of_date,
    };
  }
  if (override != null && Number.isFinite(override) && override > 0) {
    return {
      currency,
      rate_to_ils: override,
      rate_display: formatRateDisplay(override),
      source_label: 'שער מותאם',
      source: 'override',
      as_of_date,
    };
  }
  const fallback = IL_DRAFT_FX_FALLBACK_TO_ILS[currency];
  return {
    currency,
    rate_to_ils: fallback,
    rate_display: formatRateDisplay(fallback),
    source_label: 'שער יציג להיום',
    source: 'fallback_il',
    as_of_date,
  };
}
