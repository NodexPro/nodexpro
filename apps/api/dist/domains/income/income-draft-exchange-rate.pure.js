/**
 * Income wizard draft FX — backend-owned preview rates (not Accounting Base truth).
 * TEMPORARY_DRAFT_FX_PENDING: replace with Country Pack / official rate feed when available.
 */
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
/** IL preview fallbacks — updated when legal/official feed is wired. */
const IL_DRAFT_FX_FALLBACK_TO_ILS = {
    USD: 3.65,
    EUR: 4.0,
    GBP: 4.65,
};
export function isAllowedDraftLineCurrency(code) {
    return INCOME_DRAFT_ALLOWED_CURRENCIES.includes(code);
}
export function draftCurrencyLabel(code) {
    return CURRENCY_LABELS[code] ?? code;
}
export function allowedCurrencyOptions() {
    return INCOME_DRAFT_ALLOWED_CURRENCIES.map((value) => ({
        value,
        label: draftCurrencyLabel(value),
    }));
}
function formatRateDisplay(rate) {
    return rate.toFixed(4);
}
/** Default exchange rate to ILS for draft preview (1 unit foreign → ILS). */
export function resolveDraftExchangeRateToIls(currency, documentDate, override) {
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
