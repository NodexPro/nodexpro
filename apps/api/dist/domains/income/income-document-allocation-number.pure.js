/**
 * Tax allocation number (מספר הקצאה) — visibility/editability from Country Pack policy.
 * TEMPORARY_COUNTRY_PACK_PENDING: default policy until Owner Legal Control seed exists.
 */
import { INCOME_COMMAND_UPDATE_ALLOCATION_NUMBER } from './income.types.js';
export const IL_INCOME_TAX_ALLOCATION_NUMBER_POLICY_KEY = 'il_income_tax_allocation_number_policy';
/** Default applicable document types when Country Pack policy is not configured. */
const DEFAULT_APPLICABLE_TYPES = [
    'tax_invoice',
    'tax_invoice_receipt',
    'credit_tax_invoice',
];
const ALLOCATION_NUMBER_MAX_LEN = 64;
const ALLOCATION_NUMBER_PATTERN = /^[0-9]{1,64}$/;
export function defaultIncomeTaxAllocationNumberPolicy() {
    return {
        applicable_document_types: [...DEFAULT_APPLICABLE_TYPES],
        editable_after_issue: false,
        required_at_issue: false,
        empty_display: null,
    };
}
export function parseIncomeTaxAllocationNumberPolicy(raw) {
    const defaults = defaultIncomeTaxAllocationNumberPolicy();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return defaults;
    const o = raw;
    const typesRaw = Array.isArray(o.applicable_document_types)
        ? o.applicable_document_types.filter((t) => typeof t === 'string')
        : defaults.applicable_document_types;
    return {
        applicable_document_types: typesRaw,
        editable_after_issue: o.editable_after_issue === true,
        required_at_issue: o.required_at_issue === true,
        empty_display: typeof o.empty_display === 'string' && o.empty_display.trim()
            ? o.empty_display.trim()
            : defaults.empty_display,
    };
}
export function normalizeAllocationNumberInput(raw) {
    if (raw == null)
        return null;
    const trimmed = String(raw).trim();
    return trimmed || null;
}
export function validateAllocationNumberFormat(value) {
    if (value == null || !value.trim())
        return null;
    const v = value.trim();
    if (v.length > ALLOCATION_NUMBER_MAX_LEN) {
        return `מספר הקצאה ארוך מדי (מקסימום ${ALLOCATION_NUMBER_MAX_LEN} תווים)`;
    }
    if (!ALLOCATION_NUMBER_PATTERN.test(v)) {
        return 'מספר הקצאה חייב להכיל ספרות בלבד';
    }
    return null;
}
export function isAllocationNumberApplicable(policy, documentType) {
    if (!documentType)
        return false;
    return policy.applicable_document_types.includes(documentType);
}
export function buildIncomeDocumentAllocationNumberField(params) {
    const visible = isAllocationNumberApplicable(params.policy, params.documentType);
    const normalized = normalizeAllocationNumberInput(params.value);
    const emptyDisplay = (params.policy.empty_display?.trim() || 'הזינו מספר הקצאה');
    const display = normalized ?? (visible ? emptyDisplay : '—');
    let editable = params.canEdit && visible;
    let disabled_reason = null;
    if (!params.canEdit) {
        editable = false;
        disabled_reason = 'נדרשת הרשאת עריכה';
    }
    else if (params.isIssued && !params.policy.editable_after_issue) {
        editable = false;
        disabled_reason = 'לא ניתן לערוך לאחר הפקת המסמך';
    }
    else if (!visible) {
        editable = false;
        disabled_reason = null;
    }
    return {
        visible,
        value: normalized,
        display_value: display,
        editable,
        disabled_reason,
        required: visible && params.policy.required_at_issue,
        label: 'מספר הקצאה',
        placeholder: 'הזינו מספר הקצאה',
        command_name: INCOME_COMMAND_UPDATE_ALLOCATION_NUMBER,
        tooltip: editable ? 'עריכת מספר הקצאה' : disabled_reason,
        confirmation_required: false,
        confirmation_title: null,
        confirmation_message: null,
    };
}
export function allocationNumberForDocumentRender(field) {
    if (!field.visible)
        return { visible: false, display: null };
    const saved = field.value?.trim();
    return {
        visible: true,
        display: saved ?? field.display_value,
    };
}
