import { formatMoneyReference } from './income-document-draft-lines.pure.js';
export function parseDocumentDiscountFromSettings(settings) {
    return settings.discount;
}
export function normalizeDocumentDiscountInput(enabled, type, value) {
    const discountType = type === 'fixed_amount' ? 'fixed_amount' : 'percent';
    const num = Number(value);
    const safeValue = Number.isFinite(num) ? Math.max(0, num) : 0;
    return {
        enabled,
        type: discountType,
        value: enabled ? safeValue : 0,
    };
}
export function validateDocumentDiscount(discount, subtotalBeforeDiscount) {
    const errors = {};
    if (!discount.enabled)
        return errors;
    if (discount.type === 'percent') {
        if (discount.value < 0)
            errors.value = 'אחוז הנחה חייב להיות 0 ומעלה';
        if (discount.value > 100)
            errors.value = 'אחוז הנחה לא יכול לעלות על 100%';
    }
    else {
        if (discount.value < 0)
            errors.value = 'סכום הנחה חייב להיות 0 ומעלה';
        if (subtotalBeforeDiscount > 0 && discount.value > subtotalBeforeDiscount) {
            errors.value = 'סכום הנחה לא יכול לעלות על סכום ביניים לפני מע״מ';
        }
    }
    return errors;
}
export function computeDiscountAmountIls(discount, subtotalBeforeDiscount, rounding) {
    if (!discount.enabled || subtotalBeforeDiscount <= 0)
        return 0;
    let amount = 0;
    if (discount.type === 'percent') {
        const pct = Math.min(100, Math.max(0, discount.value));
        amount = (subtotalBeforeDiscount * pct) / 100;
    }
    else {
        amount = Math.max(0, discount.value);
    }
    amount = Math.min(amount, subtotalBeforeDiscount);
    if (rounding === 'nearest_agora')
        return Math.round(amount * 100) / 100;
    return Math.round(amount * 100) / 100;
}
export function formatDiscountPercentDisplay(value) {
    const pct = Math.min(100, Math.max(0, value));
    const rounded = Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/\.?0+$/, '');
    return `${rounded}%`;
}
export function formatDiscountAmountDisplay(amount, currency) {
    return formatMoneyReference(amount, currency);
}
