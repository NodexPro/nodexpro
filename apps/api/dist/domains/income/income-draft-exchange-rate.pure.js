/**
 * Income wizard draft FX — types + merge official BOI rate with user override.
 */
import { boiSourceLabel, formatBoiRateDisplay, normalizeIsoDate } from './income-boi-exchange-rate.pure.js';
export const INCOME_DRAFT_ALLOWED_CURRENCIES = [
    'ILS',
    'USD',
    'EUR',
    'GBP',
];
const CURRENCY_LABELS = {
    ILS: '₪',
    USD: '$',
    EUR: '€',
    GBP: '£',
};
const CURRENCY_ALIASES = {
    '₪': 'ILS',
    NIS: 'ILS',
    'ש"ח': 'ILS',
    'ש״ח': 'ILS',
};
export function isAllowedDraftLineCurrency(code) {
    return INCOME_DRAFT_ALLOWED_CURRENCIES.includes(code);
}
function resolveCurrencyCode(trimmed) {
    const alias = CURRENCY_ALIASES[trimmed] ?? CURRENCY_ALIASES[trimmed.toUpperCase()];
    if (alias)
        return alias;
    const code = trimmed.toUpperCase();
    if (isAllowedDraftLineCurrency(code))
        return code;
    return null;
}
export function parseDraftLineCurrency(raw) {
    const trimmed = String(raw ?? 'ILS').trim();
    return resolveCurrencyCode(trimmed) ?? 'ILS';
}
export function parseDraftLineCurrencyFromPatch(raw) {
    const trimmed = String(raw ?? '').trim();
    const resolved = resolveCurrencyCode(trimmed);
    if (!resolved) {
        throw new Error('DRAFT_LINE_CURRENCY_INVALID');
    }
    return resolved;
}
export const DRAFT_LINE_CURRENCY_INVALID_MESSAGE = 'מטבע לא נתמך';
export function parseDraftLineExchangeRateOverride(currency, raw) {
    if (currency === 'ILS')
        return null;
    if (raw === undefined || raw === null || raw === '')
        return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
        throw new Error('DRAFT_LINE_EXCHANGE_RATE_INVALID');
    }
    return n;
}
export const DRAFT_LINE_EXCHANGE_RATE_INVALID_MESSAGE = 'שער חליפין חייב להיות מספר חיובי (למטבע זר בלבד)';
export function draftCurrencyLabel(code) {
    return CURRENCY_LABELS[code] ?? code;
}
export function allowedCurrencyOptions() {
    return INCOME_DRAFT_ALLOWED_CURRENCIES.map((value) => ({
        value,
        label: draftCurrencyLabel(value),
    }));
}
export function buildDraftExchangeRateResolution(currency, documentDate, official, override) {
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
    if (!official)
        return null;
    return {
        currency,
        rate_to_ils: official.rate_to_ils,
        rate_display: official.rate_display,
        rate_official: official.rate_to_ils,
        rate_official_display: official.rate_display,
        exchange_rate_date: official.rate_date,
        source_label: boiSourceLabel(official.exact_date_match, official.rate_date, official.requested_date),
        source: official.exact_date_match ? 'boi_exact' : 'boi_previous',
    };
}
/** @deprecated use buildDraftExchangeRateResolution — sync stub for legacy callers in tests */
export function resolveDraftExchangeRateToIls(currency, documentDate, override, official) {
    return buildDraftExchangeRateResolution(currency, documentDate, official ?? null, override);
}
