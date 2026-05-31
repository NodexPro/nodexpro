import { badRequest } from '../../shared/errors.js';
import type {
  IncomeBrandingClientBlockPosition,
  IncomeBrandingDisplayOptions,
  IncomeBrandingPaymentMethod,
  IncomeBrandingProfileRow,
  IncomeBrandingQuantityPosition,
  IncomeBrandingResolvedProfile,
  IncomeDocumentStyleGradient,
  IncomeDocumentStylePreset,
} from './income-document-branding.types.js';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_DOCUMENT_STYLE_KEY = 'classic_blue';
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

/** Print-safe muted document styles — backend source of truth. */
export const INCOME_DOCUMENT_STYLE_PRESETS: IncomeDocumentStylePreset[] = [
  {
    key: 'classic_blue',
    label: 'כחול קלאסי',
    gradient: { from: '#1f4b99', to: '#2f6fd6' },
    table_header_color: '#1f4b99',
    totals_accent_color: '#1f4b99',
    recipient_block_background: '#eef4ff',
    recipient_block_border: '#1f4b99',
    text_on_dark: '#ffffff',
    text_on_light: '#172033',
    print_safe: true,
  },
  {
    key: 'soft_green',
    label: 'ירוק עדין',
    gradient: { from: '#1e5c4a', to: '#2d7a62' },
    table_header_color: '#1e5c4a',
    totals_accent_color: '#1e5c4a',
    recipient_block_background: '#eef6f3',
    recipient_block_border: '#1e5c4a',
    text_on_dark: '#ffffff',
    text_on_light: '#172033',
    print_safe: true,
  },
  {
    key: 'elegant_purple',
    label: 'סגול אלגנטי',
    gradient: { from: '#4c3d6e', to: '#6b5b8a' },
    table_header_color: '#4c3d6e',
    totals_accent_color: '#4c3d6e',
    recipient_block_background: '#f3f0f7',
    recipient_block_border: '#4c3d6e',
    text_on_dark: '#ffffff',
    text_on_light: '#172033',
    print_safe: true,
  },
  {
    key: 'professional_teal',
    label: 'טורקיז מקצועי',
    gradient: { from: '#0f5c5c', to: '#1a7878' },
    table_header_color: '#0f5c5c',
    totals_accent_color: '#0f5c5c',
    recipient_block_background: '#eef7f7',
    recipient_block_border: '#0f5c5c',
    text_on_dark: '#ffffff',
    text_on_light: '#172033',
    print_safe: true,
  },
  {
    key: 'soft_gold',
    label: 'זהב רך',
    gradient: { from: '#8a6d3b', to: '#a8864f' },
    table_header_color: '#8a6d3b',
    totals_accent_color: '#8a6d3b',
    recipient_block_background: '#faf6ef',
    recipient_block_border: '#8a6d3b',
    text_on_dark: '#ffffff',
    text_on_light: '#172033',
    print_safe: true,
  },
  {
    key: 'business_gray',
    label: 'אפור עסקי',
    gradient: { from: '#475569', to: '#64748b' },
    table_header_color: '#475569',
    totals_accent_color: '#64748b',
    recipient_block_background: '#f1f5f9',
    recipient_block_border: '#64748b',
    text_on_dark: '#ffffff',
    text_on_light: '#172033',
    print_safe: true,
  },
  {
    key: 'calm_red',
    label: 'אדום רגוע',
    gradient: { from: '#8b3a3a', to: '#a64f4f' },
    table_header_color: '#8b3a3a',
    totals_accent_color: '#8b3a3a',
    recipient_block_background: '#faf3f3',
    recipient_block_border: '#8b3a3a',
    text_on_dark: '#ffffff',
    text_on_light: '#172033',
    print_safe: true,
  },
  {
    key: 'nodexpro_gradient',
    label: 'NodexPro Gradient',
    gradient: { from: '#38bdf8', to: '#7c3aed' },
    table_header_color: '#4f46e5',
    totals_accent_color: '#4f46e5',
    recipient_block_background: '#eef2ff',
    recipient_block_border: '#4f46e5',
    text_on_dark: '#ffffff',
    text_on_light: '#172033',
    print_safe: true,
  },
];

export function getDocumentStylePresets(): IncomeDocumentStylePreset[] {
  return INCOME_DOCUMENT_STYLE_PRESETS.map((p) => ({
    ...p,
    gradient: { ...p.gradient },
  }));
}

export function resolveDocumentStylePreset(key: string): IncomeDocumentStylePreset | null {
  const k = key.trim();
  return INCOME_DOCUMENT_STYLE_PRESETS.find((p) => p.key === k) ?? null;
}

export function resolveDocumentStyleKeyForRow(row: IncomeBrandingProfileRow): string {
  const raw = row.document_style_key;
  if (typeof raw === 'string' && raw.trim() && resolveDocumentStylePreset(raw)) {
    return raw.trim();
  }
  return matchDocumentStyleKeyFromLegacyColors(
    row.primary_color,
    row.table_header_color,
    row.totals_color,
  );
}

/** Map legacy stored hex colors to closest style (no frontend logic). */
export function matchDocumentStyleKeyFromLegacyColors(
  primaryColor: string,
  tableHeaderColor: string,
  totalsColor: string,
): string {
  const p = coerceHexColor(primaryColor, DEFAULT_PRIMARY_COLOR);
  const t = coerceHexColor(tableHeaderColor, DEFAULT_PRIMARY_COLOR);
  const tot = coerceHexColor(totalsColor, DEFAULT_PRIMARY_COLOR);

  const legacyMap: Record<string, string> = {
    '#1f4b99': 'classic_blue',
    '#1e5c4a': 'soft_green',
    '#8b3a3a': 'calm_red',
    '#475569': 'business_gray',
    '#64748b': 'business_gray',
    '#1e293b': 'classic_blue',
    '#334155': 'business_gray',
    '#4c3d6e': 'elegant_purple',
    '#0f5c5c': 'professional_teal',
    '#4f46e5': 'nodexpro_gradient',
    '#3b82f6': 'nodexpro_gradient',
  };

  const combined = `${p}|${t}|${tot}`;
  for (const preset of INCOME_DOCUMENT_STYLE_PRESETS) {
    if (
      preset.table_header_color === t &&
      preset.totals_accent_color === tot &&
      preset.gradient.from === p
    ) {
      return preset.key;
    }
  }

  if (legacyMap[p]) return legacyMap[p];
  if (legacyMap[t]) return legacyMap[t];
  return DEFAULT_DOCUMENT_STYLE_KEY;
}

export function applyDocumentStyleToColorColumns(style: IncomeDocumentStylePreset): {
  document_style_key: string;
  primary_color: string;
  secondary_color: string;
  table_header_color: string;
  totals_color: string;
} {
  return {
    document_style_key: style.key,
    primary_color: style.gradient.from,
    secondary_color: style.recipient_block_background,
    table_header_color: style.table_header_color,
    totals_color: style.totals_accent_color,
  };
}

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
  const styleKey = resolveDocumentStyleKeyForRow(row);
  const style = resolveDocumentStylePreset(styleKey)!;
  const colors = applyDocumentStyleToColorColumns(style);

  return {
    document_style_key: styleKey,
    document_style: style,
    company_subtitle: row.company_subtitle?.trim() ? row.company_subtitle.trim() : null,
    primary_color: colors.primary_color,
    secondary_color: colors.secondary_color,
    table_header_color: colors.table_header_color,
    totals_color: colors.totals_color,
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

export function gradientCss(gradient: IncomeDocumentStyleGradient): string {
  return `linear-gradient(135deg, ${gradient.from} 0%, ${gradient.to} 100%)`;
}
