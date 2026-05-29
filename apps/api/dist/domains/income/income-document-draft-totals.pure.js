import { formatMoneyReference } from './income-document-draft-lines.pure.js';
import { computeDraftLineAmounts, resolveFxMapForDraftLines, resolveLineFx, } from './income-draft-line-compute.pure.js';
import { computeDiscountAmountIls } from './income-document-discount.pure.js';
import { IL_DRAFT_VAT_FALLBACK_RATE } from './income-draft-vat-fallback.pure.js';
/** @deprecated use IL_DRAFT_VAT_FALLBACK_RATE — kept for tests importing legacy name */
export const IL_DRAFT_VAT_RATE = IL_DRAFT_VAT_FALLBACK_RATE;
export const DEFAULT_DOCUMENT_DISCOUNT = {
    enabled: false,
    type: 'percent',
    value: 0,
};
export const DEFAULT_DOCUMENT_SETTINGS = {
    vat_mode: 'standard',
    amount_rounding: 'none',
    discount: { ...DEFAULT_DOCUMENT_DISCOUNT },
};
function parseDiscountJson(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return { ...DEFAULT_DOCUMENT_DISCOUNT };
    const o = raw;
    const enabled = o.enabled === true;
    const type = o.type === 'fixed_amount' ? 'fixed_amount' : 'percent';
    const num = Number(o.value);
    const value = Number.isFinite(num) ? Math.max(0, num) : 0;
    return { enabled, type, value: enabled ? value : 0 };
}
export function parseDocumentSettingsJson(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return { ...DEFAULT_DOCUMENT_SETTINGS };
    const o = raw;
    const vat_mode = o.vat_mode === 'exempt' || o.vat_mode === 'zero' || o.vat_mode === 'standard'
        ? o.vat_mode
        : DEFAULT_DOCUMENT_SETTINGS.vat_mode;
    const amount_rounding = o.amount_rounding === 'nearest_agora' ? 'nearest_agora' : DEFAULT_DOCUMENT_SETTINGS.amount_rounding;
    const discount = parseDiscountJson(o.discount);
    return { vat_mode, amount_rounding, discount };
}
export function serializeDocumentSettingsJson(settings) {
    return {
        vat_mode: settings.vat_mode,
        amount_rounding: settings.amount_rounding,
        discount: settings.discount,
    };
}
function roundAmount(value, rounding) {
    if (rounding === 'nearest_agora')
        return Math.round(value * 100) / 100;
    return Math.round(value * 100) / 100;
}
export async function computeDraftTotalsPreview(lines, currency, settings, vatResolution, documentDate) {
    const effectiveSettings = {
        ...settings,
        discount: settings.discount ?? { ...DEFAULT_DOCUMENT_DISCOUNT },
    };
    const asOf = documentDate?.trim() || new Date().toISOString().slice(0, 10);
    const officialByCurrency = await resolveFxMapForDraftLines(lines, asOf);
    const displayCurrency = 'ILS';
    const lineNets = [];
    let hasAmount = false;
    for (const line of lines) {
        const fx = resolveLineFx(line, asOf, officialByCurrency);
        if (!fx)
            continue;
        const amounts = computeDraftLineAmounts(line, effectiveSettings, vatResolution, fx);
        if (amounts.line_net_ils == null)
            continue;
        hasAmount = true;
        const netIls = amounts.line_net_ils;
        const vatRate = netIls > 0 && amounts.line_vat_ils != null ? amounts.line_vat_ils / netIls : 0;
        lineNets.push({ netIls, vatRate });
    }
    let subtotalBefore = 0;
    for (const ln of lineNets) {
        subtotalBefore += ln.netIls;
    }
    subtotalBefore = roundAmount(subtotalBefore, effectiveSettings.amount_rounding);
    const discountAmount = computeDiscountAmountIls(effectiveSettings.discount, subtotalBefore, effectiveSettings.amount_rounding);
    const subtotalAfter = hasAmount || (subtotalBefore === 0 && lines.length > 0)
        ? roundAmount(Math.max(0, subtotalBefore - discountAmount), effectiveSettings.amount_rounding)
        : 0;
    const discountFactor = subtotalBefore > 0 && effectiveSettings.discount.enabled && discountAmount > 0
        ? subtotalAfter / subtotalBefore
        : 1;
    let vat = 0;
    for (const ln of lineNets) {
        if (ln.netIls <= 0)
            continue;
        const discountedNet = roundAmount(ln.netIls * discountFactor, effectiveSettings.amount_rounding);
        vat += roundAmount(discountedNet * ln.vatRate, effectiveSettings.amount_rounding);
    }
    vat = roundAmount(vat, effectiveSettings.amount_rounding);
    let vatLabel = null;
    if (effectiveSettings.vat_mode === 'standard' && vat > 0) {
        vatLabel = vatResolution.standard_rate_percent_label;
    }
    else if (effectiveSettings.vat_mode === 'zero') {
        vatLabel = '0%';
    }
    const grand = hasAmount
        ? roundAmount(subtotalAfter + vat, effectiveSettings.amount_rounding)
        : subtotalBefore === 0 && lines.length > 0
            ? 0
            : null;
    const showVat = effectiveSettings.vat_mode === 'standard' && (vat > 0 || (hasAmount && subtotalAfter > 0));
    const subtotalBeforeRef = hasAmount
        ? subtotalBefore
        : subtotalBefore === 0 && lines.length > 0
            ? 0
            : null;
    const discountRef = effectiveSettings.discount.enabled && discountAmount > 0
        ? discountAmount
        : effectiveSettings.discount.enabled
            ? 0
            : null;
    const subtotalAfterRef = hasAmount
        ? subtotalAfter
        : subtotalBefore === 0 && lines.length > 0
            ? 0
            : null;
    return {
        preview: true,
        not_financial_truth: true,
        currency: displayCurrency,
        line_count: lines.length,
        subtotal_before_discount_reference: subtotalBeforeRef,
        discount_amount_reference: discountRef,
        subtotal_after_discount_reference: subtotalAfterRef,
        subtotal_reference: subtotalBeforeRef,
        vat_reference: showVat ? vat : effectiveSettings.vat_mode === 'zero' ? 0 : null,
        grand_total_reference: grand,
        subtotal_before_discount_display: formatMoneyReference(subtotalBeforeRef, displayCurrency),
        discount_amount_display: discountRef != null && discountRef > 0
            ? formatMoneyReference(discountRef, displayCurrency)
            : effectiveSettings.discount.enabled
                ? formatMoneyReference(0, displayCurrency)
                : null,
        subtotal_after_discount_display: formatMoneyReference(subtotalAfterRef, displayCurrency),
        subtotal_display: formatMoneyReference(subtotalBeforeRef, displayCurrency),
        vat_display: showVat ? formatMoneyReference(vat, displayCurrency) : null,
        grand_total_display: formatMoneyReference(grand, displayCurrency),
        vat_rate_label: vatLabel,
        discount_enabled: effectiveSettings.discount.enabled,
        exchange_context: { display_currency: displayCurrency, document_date: asOf },
    };
}
