import { badRequest } from '../../shared/errors.js';
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const DEFAULT_PRIMARY_COLOR = '#1f4b99';
export const DEFAULT_SECONDARY_COLOR = '#e8eef7';
export const DEFAULT_DISPLAY_OPTIONS = {
    show_logo: true,
    show_business_address: true,
    show_business_phone: true,
    show_business_email: true,
    show_business_tax_id: true,
    show_due_date: true,
    show_payment_terms: false,
    show_signature: true,
    show_footer: true,
    show_bank_details: true,
    show_notes: true,
    show_item_index: true,
    show_discount_row: true,
    show_vat_row: true,
    show_currency: true,
    quantity_position: 'before_description',
    client_block_position: 'right',
};
export const DEFAULT_PAYMENT_METHODS = [
    { key: 'bank_transfer', label: 'העברה בנקאית', enabled: true },
    { key: 'credit_card', label: 'כרטיס אשראי', enabled: false },
    { key: 'cash', label: 'מזומן', enabled: false },
    { key: 'check', label: "צ'ק", enabled: false },
];
export function coerceHexColor(value, fallback) {
    const s = String(value ?? '').trim();
    if (!s)
        return fallback;
    const withHash = s.startsWith('#') ? s : `#${s}`;
    return HEX_COLOR_RE.test(withHash) ? withHash.toLowerCase() : fallback;
}
export function normalizeHexColor(value, fallback, field) {
    const s = String(value ?? '').trim();
    if (!s)
        return fallback;
    const withHash = s.startsWith('#') ? s : `#${s}`;
    if (!HEX_COLOR_RE.test(withHash)) {
        throw badRequest(`${field} must be a hex color like #1f4b99`, 'INVALID_BRANDING_COLOR');
    }
    return withHash.toLowerCase();
}
export function normalizeClientBlockPosition(value) {
    return value === 'left' ? 'left' : 'right';
}
function normalizeQuantityPosition(value) {
    return value === 'after_description' ? 'after_description' : 'before_description';
}
export function parseDisplayOptionsJson(raw, clientBlockPosition) {
    const base = { ...DEFAULT_DISPLAY_OPTIONS, client_block_position: clientBlockPosition };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return base;
    const o = raw;
    return {
        show_logo: o.show_logo !== false,
        show_business_address: o.show_business_address !== false,
        show_business_phone: o.show_business_phone !== false,
        show_business_email: o.show_business_email !== false,
        show_business_tax_id: o.show_business_tax_id !== false,
        show_due_date: o.show_due_date !== false,
        show_payment_terms: o.show_payment_terms === true,
        show_signature: o.show_signature !== false,
        show_footer: o.show_footer !== false,
        show_bank_details: o.show_bank_details !== false,
        show_notes: o.show_notes !== false,
        show_item_index: o.show_item_index !== false,
        show_discount_row: o.show_discount_row !== false,
        show_vat_row: o.show_vat_row !== false,
        show_currency: o.show_currency !== false,
        quantity_position: normalizeQuantityPosition(o.quantity_position),
        client_block_position: normalizeClientBlockPosition(o.client_block_position ?? clientBlockPosition),
    };
}
export function serializeDisplayOptionsJson(opts) {
    return { ...opts };
}
export function parsePaymentMethodsJson(raw) {
    if (!Array.isArray(raw) || raw.length === 0)
        return DEFAULT_PAYMENT_METHODS.map((m) => ({ ...m }));
    const out = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object' || Array.isArray(item))
            continue;
        const o = item;
        const key = typeof o.key === 'string' ? o.key.trim() : '';
        if (!key)
            continue;
        out.push({
            key,
            label: typeof o.label === 'string' && o.label.trim() ? o.label.trim() : key,
            enabled: o.enabled === true,
        });
    }
    return out.length ? out : DEFAULT_PAYMENT_METHODS.map((m) => ({ ...m }));
}
export function serializePaymentMethodsJson(methods) {
    return methods.map((m) => ({ key: m.key, label: m.label, enabled: m.enabled }));
}
export function resolveBrandingProfile(row, assets) {
    const clientBlockPosition = normalizeClientBlockPosition(row.client_block_position);
    return {
        company_subtitle: row.company_subtitle?.trim() ? row.company_subtitle.trim() : null,
        primary_color: coerceHexColor(row.primary_color, DEFAULT_PRIMARY_COLOR),
        secondary_color: coerceHexColor(row.secondary_color, DEFAULT_SECONDARY_COLOR),
        table_header_color: coerceHexColor(row.table_header_color, DEFAULT_PRIMARY_COLOR),
        totals_color: coerceHexColor(row.totals_color, DEFAULT_PRIMARY_COLOR),
        client_block_position: clientBlockPosition,
        footer_text: row.footer_text?.trim() ? row.footer_text.trim() : null,
        bank_name: row.bank_name?.trim() ? row.bank_name.trim() : null,
        bank_branch: row.bank_branch?.trim() ? row.bank_branch.trim() : null,
        bank_account: row.bank_account?.trim() ? row.bank_account.trim() : null,
        swift: row.swift?.trim() ? row.swift.trim() : null,
        iban: row.iban?.trim() ? row.iban.trim() : null,
        email_subject_template: row.email_subject_template?.trim() ? row.email_subject_template.trim() : null,
        email_body_template: row.email_body_template?.trim() ? row.email_body_template.trim() : null,
        customer_notes: row.customer_notes?.trim() ? row.customer_notes.trim() : null,
        terms_and_conditions: row.terms_and_conditions?.trim() ? row.terms_and_conditions.trim() : null,
        display_options: parseDisplayOptionsJson(row.display_options, clientBlockPosition),
        payment_methods: parsePaymentMethodsJson(row.payment_methods),
        logo_data_url: assets.logo_data_url,
        signature_data_url: assets.signature_data_url,
    };
}
/** Print-safe muted palettes — no pure black backgrounds, no neon. */
export const INCOME_BRANDING_COLOR_PRESETS = [
    {
        key: 'blue',
        label: 'כחול',
        primary_color: '#1f4b99',
        table_header_color: '#1f4b99',
        totals_color: '#1f4b99',
        secondary_color: '#e8eef7',
        text_color: '#0f172a',
        print_safe: true,
    },
    {
        key: 'green',
        label: 'ירוק',
        primary_color: '#1e5c4a',
        table_header_color: '#1e5c4a',
        totals_color: '#1e5c4a',
        secondary_color: '#eef6f3',
        text_color: '#0f172a',
        print_safe: true,
    },
    {
        key: 'red',
        label: 'אדום עמום',
        primary_color: '#8b3a3a',
        table_header_color: '#8b3a3a',
        totals_color: '#8b3a3a',
        secondary_color: '#faf3f3',
        text_color: '#0f172a',
        print_safe: true,
    },
    {
        key: 'light',
        label: 'בהיר',
        primary_color: '#475569',
        table_header_color: '#64748b',
        totals_color: '#64748b',
        secondary_color: '#f8fafc',
        text_color: '#0f172a',
        print_safe: true,
    },
    {
        key: 'navy',
        label: 'כחול כהה',
        primary_color: '#1e293b',
        table_header_color: '#334155',
        totals_color: '#334155',
        secondary_color: '#f1f5f9',
        text_color: '#0f172a',
        print_safe: true,
    },
    {
        key: 'purple',
        label: 'סגול',
        primary_color: '#4c3d6e',
        table_header_color: '#4c3d6e',
        totals_color: '#4c3d6e',
        secondary_color: '#f3f0f7',
        text_color: '#0f172a',
        print_safe: true,
    },
    {
        key: 'teal',
        label: 'טורקיז',
        primary_color: '#0f5c5c',
        table_header_color: '#0f5c5c',
        totals_color: '#0f5c5c',
        secondary_color: '#eef7f7',
        text_color: '#0f172a',
        print_safe: true,
    },
    {
        key: 'nodexpro',
        label: 'NodexPro',
        primary_color: '#4f46e5',
        table_header_color: '#3b82f6',
        totals_color: '#4f46e5',
        secondary_color: '#eef2ff',
        text_color: '#0f172a',
        print_safe: true,
    },
];
export function getBrandingColorPresets() {
    return INCOME_BRANDING_COLOR_PRESETS.map((p) => ({ ...p }));
}
export function resolveBrandingColorPreset(key) {
    const k = key.trim();
    return INCOME_BRANDING_COLOR_PRESETS.find((p) => p.key === k) ?? null;
}
export function matchBrandingColorPresetKey(primaryColor, tableHeaderColor, totalsColor) {
    const p = coerceHexColor(primaryColor, DEFAULT_PRIMARY_COLOR);
    const t = coerceHexColor(tableHeaderColor, DEFAULT_PRIMARY_COLOR);
    const tot = coerceHexColor(totalsColor, DEFAULT_PRIMARY_COLOR);
    const hit = INCOME_BRANDING_COLOR_PRESETS.find((preset) => preset.primary_color === p && preset.table_header_color === t && preset.totals_color === tot);
    return hit?.key ?? 'blue';
}
export function optionalTrimmedString(value, maxLen) {
    if (value === null || value === undefined)
        return null;
    const s = String(value).trim();
    if (!s)
        return null;
    if (s.length > maxLen) {
        throw badRequest(`Text exceeds maximum length of ${maxLen}`, 'BRANDING_TEXT_TOO_LONG');
    }
    return s;
}
