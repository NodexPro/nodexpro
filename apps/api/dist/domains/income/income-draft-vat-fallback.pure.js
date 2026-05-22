/** IL fallback when Country Pack has no active legal value (current statutory rate). */
export const IL_DRAFT_VAT_FALLBACK_RATE = 0.18;
function formatPercentLabel(rate) {
    const pct = Math.round(rate * 100);
    return `${pct}%`;
}
function resolutionFromRate(rate, source, key) {
    const pctLabel = formatPercentLabel(rate);
    return {
        standard_rate: rate,
        standard_rate_percent_label: pctLabel,
        standard_vat_mode_option_label: `מע״מ רגיל (${pctLabel})`,
        source,
        legal_value_key: key,
    };
}
/** Synchronous IL fallback when org/ruleset resolution is not available. */
export function incomeDraftVatFallbackResolution() {
    return resolutionFromRate(IL_DRAFT_VAT_FALLBACK_RATE, 'fallback_il', null);
}
export function compactVatSelectLabel(vat) {
    return `מע״מ ${vat.standard_rate_percent_label}`;
}
export function readVatResolutionFromDraftPreview(raw, documentDate) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const o = raw;
    const cache = o.vat_resolution_cache;
    if (!cache || typeof cache !== 'object' || Array.isArray(cache))
        return null;
    const c = cache;
    if (c.document_date !== documentDate)
        return null;
    const rate = Number(c.standard_rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1)
        return null;
    const pctLabel = typeof c.standard_rate_percent_label === 'string'
        ? c.standard_rate_percent_label
        : formatPercentLabel(rate);
    return {
        standard_rate: rate,
        standard_rate_percent_label: pctLabel,
        standard_vat_mode_option_label: typeof c.standard_vat_mode_option_label === 'string'
            ? c.standard_vat_mode_option_label
            : `מע״מ רגיל (${pctLabel})`,
        source: c.source === 'country_pack' ? 'country_pack' : 'fallback_il',
        legal_value_key: typeof c.legal_value_key === 'string' ? c.legal_value_key : null,
    };
}
export function vatResolutionCachePayload(documentDate, vat) {
    return {
        document_date: documentDate,
        standard_rate: vat.standard_rate,
        standard_rate_percent_label: vat.standard_rate_percent_label,
        standard_vat_mode_option_label: vat.standard_vat_mode_option_label,
        source: vat.source,
        legal_value_key: vat.legal_value_key,
    };
}
