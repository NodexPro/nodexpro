import { badRequest } from '../../shared/errors.js';
const IL_DOCUMENT_TYPE_DEFS = [
    {
        key: 'receipt',
        label: 'קבלה',
        requires_payment_received: true,
        requires_due_date: false,
        allows_credit: false,
    },
    {
        key: 'tax_invoice',
        label: 'חשבונית מס',
        requires_payment_received: false,
        requires_due_date: true,
        allows_credit: false,
    },
    {
        key: 'tax_invoice_receipt',
        label: 'חשבונית מס/קבלה',
        requires_payment_received: true,
        requires_due_date: false,
        allows_credit: false,
    },
    {
        key: 'credit_tax_invoice',
        label: 'חשבונית מס זיכוי',
        requires_payment_received: false,
        requires_due_date: false,
        allows_credit: true,
    },
    {
        key: 'deal_invoice',
        label: 'חשבון עסקה',
        requires_payment_received: false,
        requires_due_date: true,
        allows_credit: false,
    },
    {
        key: 'quote',
        label: 'הצעת מחיר',
        requires_payment_received: false,
        requires_due_date: false,
        allows_credit: false,
    },
];
const PATUR_ALLOWED = new Set(['receipt', 'deal_invoice', 'quote']);
const PATUR_DISABLED_REASON = 'Not available for עוסק פטור (osek_patur). Use receipt, deal invoice, or quote.';
const UNKNOWN_ALLOWED = new Set(['quote', 'deal_invoice']);
const UNKNOWN_DISABLED_REASON = 'Business type is not configured. Configure business profile to enable additional document types.';
function isEnabledForBusinessType(key, businessType) {
    if (businessType === 'osek_patur') {
        if (PATUR_ALLOWED.has(key))
            return { enabled: true, disabled_reason: null, legal_hint: null };
        return {
            enabled: false,
            disabled_reason: PATUR_DISABLED_REASON,
            legal_hint: 'Tax invoices require VAT-registered business (עוסק מורשה / company).',
        };
    }
    if (businessType === 'osek_murshe' || businessType === 'company' || businessType === 'nonprofit') {
        return { enabled: true, disabled_reason: null, legal_hint: null };
    }
    if (UNKNOWN_ALLOWED.has(key)) {
        return {
            enabled: true,
            disabled_reason: null,
            legal_hint: 'Enabled while business type is unknown (limited set).',
        };
    }
    return {
        enabled: false,
        disabled_reason: UNKNOWN_DISABLED_REASON,
        legal_hint: null,
    };
}
export function normalizeIssuerBusinessType(raw) {
    const code = String(raw ?? '').trim().toLowerCase();
    if (code === 'osek_patur' || code === 'פטור')
        return 'osek_patur';
    if (code === 'osek_murshe' || code === 'מורשה')
        return 'osek_murshe';
    if (code === 'company' || code === 'חברה')
        return 'company';
    if (code === 'nonprofit' || code === 'עמותה')
        return 'nonprofit';
    return 'unknown';
}
export function buildAvailableDocumentTypesForBusiness(businessType, country_code = 'IL', ruleset_id = null, source = 'fallback_il') {
    return IL_DOCUMENT_TYPE_DEFS.map((def) => {
        const eligibility = isEnabledForBusinessType(def.key, businessType);
        return {
            key: def.key,
            label: def.label,
            enabled: eligibility.enabled,
            disabled_reason: eligibility.disabled_reason,
            requires_payment_received: def.requires_payment_received,
            requires_due_date: def.requires_due_date,
            allows_credit: def.allows_credit,
            source,
            country_code,
            ruleset_id,
            legal_hint: eligibility.legal_hint,
        };
    });
}
export function assertDocumentTypeEnabled(available, documentType) {
    if (!documentType)
        throw badRequest('document_type is required');
    const entry = available.find((t) => t.key === documentType);
    if (!entry)
        throw badRequest('document_type is invalid');
    if (!entry.enabled) {
        throw badRequest(entry.disabled_reason ?? 'document_type is disabled for this issuer');
    }
}
export function findAvailableDocumentType(available, documentType) {
    return available.find((t) => t.key === documentType);
}
