import { badRequest } from '../../shared/errors.js';
import type {
  IncomeBrandingClientBlockPosition,
  IncomeBrandingDisplayOptions,
  IncomeBrandingPaymentMethod,
  IncomeBrandingProfileRow,
  IncomeBrandingQuantityPosition,
  IncomeBrandingResolvedProfile,
} from './income-document-branding.types.js';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_PRIMARY_COLOR = '#1f4b99';
export const DEFAULT_SECONDARY_COLOR = '#e8eef7';

export const DEFAULT_DISPLAY_OPTIONS: IncomeBrandingDisplayOptions = {
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

export const DEFAULT_PAYMENT_METHODS: IncomeBrandingPaymentMethod[] = [
  { key: 'bank_transfer', label: 'העברה בנקאית', enabled: true },
  { key: 'credit_card', label: 'כרטיס אשראי', enabled: false },
  { key: 'cash', label: 'מזומן', enabled: false },
  { key: 'check', label: "צ'ק", enabled: false },
];

export function coerceHexColor(value: unknown, fallback: string): string {
  const s = String(value ?? '').trim();
  if (!s) return fallback;
  const withHash = s.startsWith('#') ? s : `#${s}`;
  return HEX_COLOR_RE.test(withHash) ? withHash.toLowerCase() : fallback;
}

export function normalizeHexColor(value: unknown, fallback: string, field: string): string {
  const s = String(value ?? '').trim();
  if (!s) return fallback;
  const withHash = s.startsWith('#') ? s : `#${s}`;
  if (!HEX_COLOR_RE.test(withHash)) {
    throw badRequest(`${field} must be a hex color like #1f4b99`, 'INVALID_BRANDING_COLOR');
  }
  return withHash.toLowerCase();
}

export function normalizeClientBlockPosition(value: unknown): IncomeBrandingClientBlockPosition {
  return value === 'left' ? 'left' : 'right';
}

function normalizeQuantityPosition(value: unknown): IncomeBrandingQuantityPosition {
  return value === 'after_description' ? 'after_description' : 'before_description';
}

export function parseDisplayOptionsJson(
  raw: unknown,
  clientBlockPosition: IncomeBrandingClientBlockPosition,
): IncomeBrandingDisplayOptions {
  const base = { ...DEFAULT_DISPLAY_OPTIONS, client_block_position: clientBlockPosition };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
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

export function serializeDisplayOptionsJson(opts: IncomeBrandingDisplayOptions): Record<string, unknown> {
  return { ...opts };
}

export function parsePaymentMethodsJson(raw: unknown): IncomeBrandingPaymentMethod[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_PAYMENT_METHODS.map((m) => ({ ...m }));
  const out: IncomeBrandingPaymentMethod[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const key = typeof o.key === 'string' ? o.key.trim() : '';
    if (!key) continue;
    out.push({
      key,
      label: typeof o.label === 'string' && o.label.trim() ? o.label.trim() : key,
      enabled: o.enabled === true,
    });
  }
  return out.length ? out : DEFAULT_PAYMENT_METHODS.map((m) => ({ ...m }));
}

export function serializePaymentMethodsJson(methods: IncomeBrandingPaymentMethod[]): unknown[] {
  return methods.map((m) => ({ key: m.key, label: m.label, enabled: m.enabled }));
}

export function resolveBrandingProfile(
  row: IncomeBrandingProfileRow,
  assets: { logo_data_url: string | null; signature_data_url: string | null },
): IncomeBrandingResolvedProfile {
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

export function optionalTrimmedString(value: unknown, maxLen: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.length > maxLen) {
    throw badRequest(`Text exceeds maximum length of ${maxLen}`, 'BRANDING_TEXT_TOO_LONG');
  }
  return s;
}
