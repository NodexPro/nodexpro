import { badRequest } from '../../shared/errors.js';
import type {
  IncomeBrandingClientBlockPosition,
  IncomeBrandingDisplayOptions,
  IncomeBrandingPaymentMethod,
  IncomeBrandingProfileRow,
  IncomeBrandingQuantityPosition,
  IncomeBrandingResolvedProfile,
  IncomeColorThemePreset,
  IncomeDocumentStyleGradient,
  IncomeDocumentStyleTemplate,
  IncomeDocumentStyleTemplateKey,
  IncomeEmailTemplateToken,
  IncomeLayoutTemplate,
  IncomeLayoutTemplateKey,
  IncomeLogoSizeKey,
  IncomeLogoSizeOption,
} from './income-document-branding.types.js';
import { STUDIO_DOCUMENT_STYLE_KEYS } from './income-document-branding.types.js';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_DOCUMENT_STYLE_KEY: IncomeDocumentStyleTemplateKey = 'classic';
export const DEFAULT_COLOR_THEME_KEY = 'modern_blue';
export const DEFAULT_LOGO_SIZE_KEY: IncomeLogoSizeKey = 'medium';
export const DEFAULT_PRIMARY_COLOR = '#1f4b99';
export const DEFAULT_SECONDARY_COLOR = '#e8eef7';

const LEGACY_COLOR_KEYS = new Set([
  'classic_blue',
  'soft_green',
  'elegant_purple',
  'professional_teal',
  'soft_gold',
  'business_gray',
  'calm_red',
  'nodexpro_gradient',
]);

export const LEGACY_COLOR_KEY_TO_THEME: Record<string, string> = {
  classic_blue: 'modern_blue',
  soft_green: 'emerald',
  elegant_purple: 'royal_purple',
  professional_teal: 'emerald',
  soft_gold: 'elegant_gold',
  business_gray: 'clean_gray',
  calm_red: 'executive_navy',
  nodexpro_gradient: 'nodexpro_gradient',
};

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

function buildThemeMiniPreview(theme: IncomeColorThemePreset): string {
  const grad = gradientCss(theme.gradient);
  return `<div class="nx-studio-theme-mini" dir="rtl">
<div class="nx-studio-theme-mini__strip" style="background:${grad}"></div>
<div class="nx-studio-theme-mini__recipient" style="border-inline-start-color:${theme.recipient_accent_color};background:${theme.recipient_block_background}"></div>
<div class="nx-studio-theme-mini__table" style="background:${theme.table_header_color}"></div>
<div class="nx-studio-theme-mini__totals" style="border-top-color:${theme.totals_accent_color}"></div>
</div>`;
}

function buildStyleMiniPreview(
  styleKey: IncomeDocumentStyleTemplateKey,
  theme: IncomeColorThemePreset,
): string {
  const accent = theme.recipient_accent_color;
  const header = theme.table_header_color;
  const totals = theme.totals_accent_color;
  const grad = gradientCss(theme.gradient);

  if (styleKey === 'elegant') {
    return `<div class="nx-studio-style-mini nx-studio-style-mini--elegant" dir="rtl">
<div class="nx-studio-style-mini__row"><span class="nx-studio-style-mini__logo nx-studio-style-mini__logo--large"></span><span class="nx-studio-style-mini__company"></span></div>
<div class="nx-studio-style-mini__rule" style="background:${accent}"></div>
<div class="nx-studio-style-mini__recipient nx-studio-style-mini__recipient--elegant" style="border-inline-start-color:${accent}"></div>
<div class="nx-studio-style-mini__title-line nx-studio-style-mini__title-line--elegant" style="border-bottom-color:${accent}"></div>
<div class="nx-studio-style-mini__table" style="background:${header}"></div>
<div class="nx-studio-style-mini__totals nx-studio-style-mini__totals--elegant" style="border-top-color:${totals}"></div>
</div>`;
  }
  if (styleKey === 'modern') {
    return `<div class="nx-studio-style-mini nx-studio-style-mini--modern" dir="rtl">
<div class="nx-studio-style-mini__modern-top"><span class="nx-studio-style-mini__logo nx-studio-style-mini__logo--small"></span><span class="nx-studio-style-mini__company-lines"></span></div>
<div class="nx-studio-style-mini__rule nx-studio-style-mini__rule--thin"></div>
<div class="nx-studio-style-mini__recipient nx-studio-style-mini__recipient--open"></div>
<div class="nx-studio-style-mini__title-line" style="border-bottom-color:${accent}"></div>
<div class="nx-studio-style-mini__table nx-studio-style-mini__table--light" style="border-bottom:2px solid ${header}"></div>
<div class="nx-studio-style-mini__totals nx-studio-style-mini__totals--open" style="border-top-color:${totals}"></div>
</div>`;
  }
  return `<div class="nx-studio-style-mini nx-studio-style-mini--classic" dir="rtl">
<div class="nx-studio-style-mini__row"><span class="nx-studio-style-mini__logo"></span><span class="nx-studio-style-mini__recipient" style="border-inline-start-color:${accent}"></span></div>
<div class="nx-studio-style-mini__banner" style="background:${grad}"></div>
<div class="nx-studio-style-mini__table" style="background:${header}"></div>
<div class="nx-studio-style-mini__totals" style="border-top-color:${totals}"></div>
</div>`;
}

const COLOR_THEME_DEFS: Omit<IncomeColorThemePreset, 'mini_preview_markup'>[] = [
  {
    key: 'modern_blue',
    label: 'Modern Blue',
    gradient: { from: '#1f4b99', to: '#2f6fd6' },
    table_header_color: '#1f4b99',
    totals_accent_color: '#1f4b99',
    recipient_accent_color: '#1f4b99',
    recipient_block_background: '#f8fafc',
    recipient_block_border: '#cbd5e1',
    text_on_dark: '#ffffff',
    text_on_light: '#172033',
    print_safe: true,
  },
  {
    key: 'executive_navy',
    label: 'Executive Navy',
    gradient: { from: '#1e293b', to: '#334155' },
    table_header_color: '#1e293b',
    totals_accent_color: '#334155',
    recipient_accent_color: '#334155',
    recipient_block_background: '#f8fafc',
    recipient_block_border: '#cbd5e1',
    text_on_dark: '#ffffff',
    text_on_light: '#172033',
    print_safe: true,
  },
  {
    key: 'elegant_gold',
    label: 'Elegant Gold',
    gradient: { from: '#8a6d3b', to: '#c4a35a' },
    table_header_color: '#8a6d3b',
    totals_accent_color: '#8a6d3b',
    recipient_accent_color: '#8a6d3b',
    recipient_block_background: '#faf8f3',
    recipient_block_border: '#d4c4a8',
    text_on_dark: '#ffffff',
    text_on_light: '#172033',
    print_safe: true,
  },
  {
    key: 'emerald',
    label: 'Emerald',
    gradient: { from: '#1e5c4a', to: '#2d7a62' },
    table_header_color: '#1e5c4a',
    totals_accent_color: '#1e5c4a',
    recipient_accent_color: '#1e5c4a',
    recipient_block_background: '#f8faf9',
    recipient_block_border: '#cbd5e1',
    text_on_dark: '#ffffff',
    text_on_light: '#172033',
    print_safe: true,
  },
  {
    key: 'royal_purple',
    label: 'Royal Purple',
    gradient: { from: '#4c3d6e', to: '#6b5b8a' },
    table_header_color: '#4c3d6e',
    totals_accent_color: '#4c3d6e',
    recipient_accent_color: '#4c3d6e',
    recipient_block_background: '#f9f8fb',
    recipient_block_border: '#cbd5e1',
    text_on_dark: '#ffffff',
    text_on_light: '#172033',
    print_safe: true,
  },
  {
    key: 'clean_gray',
    label: 'Clean Gray',
    gradient: { from: '#475569', to: '#64748b' },
    table_header_color: '#475569',
    totals_accent_color: '#64748b',
    recipient_accent_color: '#64748b',
    recipient_block_background: '#f8fafc',
    recipient_block_border: '#cbd5e1',
    text_on_dark: '#ffffff',
    text_on_light: '#172033',
    print_safe: true,
  },
  {
    key: 'minimal_light',
    label: 'Minimal Light',
    gradient: { from: '#94a3b8', to: '#cbd5e1' },
    table_header_color: '#64748b',
    totals_accent_color: '#475569',
    recipient_accent_color: '#64748b',
    recipient_block_background: '#ffffff',
    recipient_block_border: '#e2e8f0',
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
    recipient_accent_color: '#4f46e5',
    recipient_block_background: '#f8fafc',
    recipient_block_border: '#cbd5e1',
    text_on_dark: '#ffffff',
    text_on_light: '#172033',
    print_safe: true,
  },
];

export const INCOME_COLOR_THEME_PRESETS: IncomeColorThemePreset[] = COLOR_THEME_DEFS.map((t) => ({
  ...t,
  gradient: { ...t.gradient },
  mini_preview_markup: buildThemeMiniPreview({ ...t, mini_preview_markup: '' }),
}));

const STYLE_TEMPLATE_DEFS: Omit<IncomeDocumentStyleTemplate, 'mini_preview_markup'>[] = [
  {
    key: 'classic',
    label: 'קלאסי',
    description: 'מסמך מסורתי — לוגו ופרטי עסק, בלוק לקוח מול כותרת בולטת',
    default_layout_template_key: 'logo_left_client_right',
  },
  {
    key: 'modern',
    label: 'מודרני',
    description: 'ריווח נקי, קווים דקים, כותרת קלה ללא בלוק צבע מלא',
    default_layout_template_key: 'logo_left_client_right',
  },
  {
    key: 'elegant',
    label: 'אלגנטי',
    description: 'פרימיום עסקי — לוגו גדול, קווי הדגשה עדינים, סה״כ אלגנטי',
    default_layout_template_key: 'logo_left_client_right',
  },
];

export const INCOME_DOCUMENT_STYLE_TEMPLATES: IncomeDocumentStyleTemplate[] = STYLE_TEMPLATE_DEFS.map(
  (s) => {
    const theme = resolveColorThemePreset(DEFAULT_COLOR_THEME_KEY)!;
    return {
      ...s,
      mini_preview_markup: buildStyleMiniPreview(s.key, theme),
    };
  },
);

export const INCOME_LAYOUT_TEMPLATES: IncomeLayoutTemplate[] = [
  {
    key: 'logo_left_client_right',
    label: 'לוגו משמאל · לקוח מימין',
    mini_preview_markup:
      '<div class="nx-studio-layout-mini nx-studio-layout-mini--llcr" dir="rtl"><span></span><span></span></div>',
    advanced_only: true,
  },
  {
    key: 'logo_top_client_below',
    label: 'לוגו למעלה · לקוח מתחת',
    mini_preview_markup:
      '<div class="nx-studio-layout-mini nx-studio-layout-mini--ltcb" dir="rtl"><span></span><span></span></div>',
    advanced_only: true,
  },
  {
    key: 'israeli_classic',
    label: 'קלאסי ישראלי',
    mini_preview_markup:
      '<div class="nx-studio-layout-mini nx-studio-layout-mini--il" dir="rtl"><span></span><span></span></div>',
    advanced_only: true,
  },
  {
    key: 'logo_right_client_left',
    label: 'לוגו מימין · לקוח משמאל',
    mini_preview_markup:
      '<div class="nx-studio-layout-mini nx-studio-layout-mini--lrl" dir="rtl"><span></span><span></span></div>',
    advanced_only: true,
  },
];

export const INCOME_LOGO_SIZE_OPTIONS: IncomeLogoSizeOption[] = [
  { key: 'small', label: 'קטן', preview_max_width_px: 180, preview_max_height_px: 80 },
  { key: 'medium', label: 'בינוני', preview_max_width_px: 260, preview_max_height_px: 120 },
  { key: 'large', label: 'גדול', preview_max_width_px: 320, preview_max_height_px: 160 },
];

/** @deprecated Use getColorThemePresets */
export const INCOME_DOCUMENT_STYLE_PRESETS = INCOME_COLOR_THEME_PRESETS;

export function getColorThemePresets(): IncomeColorThemePreset[] {
  return INCOME_COLOR_THEME_PRESETS.map((p) => ({
    ...p,
    gradient: { ...p.gradient },
    mini_preview_markup: buildThemeMiniPreview(p),
  }));
}

/** @deprecated Use getColorThemePresets */
export function getDocumentStylePresets(): IncomeColorThemePreset[] {
  return getColorThemePresets();
}

export function getDocumentStyleTemplates(selectedThemeKey?: string): IncomeDocumentStyleTemplate[] {
  const theme = resolveColorThemePreset(selectedThemeKey ?? DEFAULT_COLOR_THEME_KEY)!;
  return STUDIO_DOCUMENT_STYLE_KEYS.map((key) => {
    const def = STYLE_TEMPLATE_DEFS.find((s) => s.key === key)!;
    return {
      ...def,
      mini_preview_markup: buildStyleMiniPreview(key, theme),
    };
  });
}

export function normalizeStudioDocumentStyleKey(key: string | null | undefined): IncomeDocumentStyleTemplateKey {
  const k = String(key ?? '').trim();
  if (k === 'minimal') return 'modern';
  if (STUDIO_DOCUMENT_STYLE_KEYS.includes(k as IncomeDocumentStyleTemplateKey)) {
    return k as IncomeDocumentStyleTemplateKey;
  }
  return DEFAULT_DOCUMENT_STYLE_KEY;
}

export function getLayoutTemplates(): IncomeLayoutTemplate[] {
  return INCOME_LAYOUT_TEMPLATES.map((t) => ({ ...t }));
}

export function getLogoSizeOptions(): IncomeLogoSizeOption[] {
  return INCOME_LOGO_SIZE_OPTIONS.map((o) => ({ ...o }));
}

export function resolveColorThemePreset(key: string): IncomeColorThemePreset | null {
  const k = key.trim();
  return INCOME_COLOR_THEME_PRESETS.find((p) => p.key === k) ?? null;
}

/** @deprecated Use resolveColorThemePreset */
export function resolveDocumentStylePreset(key: string): IncomeColorThemePreset | null {
  const k = key.trim();
  if (LEGACY_COLOR_KEYS.has(k)) {
    const mapped = LEGACY_COLOR_KEY_TO_THEME[k];
    return mapped ? resolveColorThemePreset(mapped) : null;
  }
  return resolveColorThemePreset(k);
}

export function resolveDocumentStyleTemplate(key: string): IncomeDocumentStyleTemplate | null {
  const raw = String(key ?? '').trim();
  if (LEGACY_COLOR_KEYS.has(raw)) return null;
  const normalized = normalizeStudioDocumentStyleKey(raw || null);
  const def = STYLE_TEMPLATE_DEFS.find((s) => s.key === normalized);
  if (!def) return null;
  const theme = resolveColorThemePreset(DEFAULT_COLOR_THEME_KEY)!;
  return {
    ...def,
    mini_preview_markup: buildStyleMiniPreview(def.key, theme),
  };
}

export function resolveLayoutTemplate(key: string): IncomeLayoutTemplate | null {
  const k = key.trim() as IncomeLayoutTemplateKey;
  return INCOME_LAYOUT_TEMPLATES.find((t) => t.key === k) ?? null;
}

export function resolveLogoSizeKey(value: unknown): IncomeLogoSizeKey {
  const k = String(value ?? '').trim();
  if (k === 'small' || k === 'large') return k;
  return DEFAULT_LOGO_SIZE_KEY;
}

export function resolveDocumentStyleKeyForRow(row: IncomeBrandingProfileRow): IncomeDocumentStyleTemplateKey {
  const raw = String(row.document_style_key ?? '').trim();
  if (LEGACY_COLOR_KEYS.has(raw)) {
    return DEFAULT_DOCUMENT_STYLE_KEY;
  }
  return normalizeStudioDocumentStyleKey(raw || null);
}

export function resolveColorThemeKeyForRow(row: IncomeBrandingProfileRow): string {
  const explicit = String(row.color_theme_key ?? '').trim();
  if (explicit && resolveColorThemePreset(explicit)) {
    return explicit;
  }
  const styleRaw = String(row.document_style_key ?? '').trim();
  if (LEGACY_COLOR_KEYS.has(styleRaw)) {
    return LEGACY_COLOR_KEY_TO_THEME[styleRaw] ?? DEFAULT_COLOR_THEME_KEY;
  }
  return matchColorThemeKeyFromLegacyColors(
    row.primary_color,
    row.table_header_color,
    row.totals_color,
  );
}

export function resolveEffectiveLayoutTemplateKey(
  row: IncomeBrandingProfileRow,
): IncomeLayoutTemplateKey {
  const override = String(row.layout_template_key ?? '').trim();
  if (override && resolveLayoutTemplate(override)) {
    return override as IncomeLayoutTemplateKey;
  }
  const styleKey = resolveDocumentStyleKeyForRow(row);
  const template = resolveDocumentStyleTemplate(styleKey);
  return template?.default_layout_template_key ?? 'logo_left_client_right';
}

export function matchColorThemeKeyFromLegacyColors(
  primaryColor: string,
  tableHeaderColor: string,
  totalsColor: string,
): string {
  const p = coerceHexColor(primaryColor, DEFAULT_PRIMARY_COLOR);
  const t = coerceHexColor(tableHeaderColor, DEFAULT_PRIMARY_COLOR);
  const tot = coerceHexColor(totalsColor, DEFAULT_PRIMARY_COLOR);

  const legacyMap: Record<string, string> = {
    '#1f4b99': 'modern_blue',
    '#1e5c4a': 'emerald',
    '#8b3a3a': 'executive_navy',
    '#475569': 'clean_gray',
    '#64748b': 'clean_gray',
    '#1e293b': 'executive_navy',
    '#334155': 'executive_navy',
    '#4c3d6e': 'royal_purple',
    '#0f5c5c': 'emerald',
    '#4f46e5': 'nodexpro_gradient',
    '#3b82f6': 'nodexpro_gradient',
    '#8a6d3b': 'elegant_gold',
  };

  for (const preset of INCOME_COLOR_THEME_PRESETS) {
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
  return DEFAULT_COLOR_THEME_KEY;
}

/** @deprecated Use matchColorThemeKeyFromLegacyColors */
export function matchDocumentStyleKeyFromLegacyColors(
  primaryColor: string,
  tableHeaderColor: string,
  totalsColor: string,
): string {
  return matchColorThemeKeyFromLegacyColors(primaryColor, tableHeaderColor, totalsColor);
}

export function applyColorThemeToColorColumns(theme: IncomeColorThemePreset): {
  color_theme_key: string;
  primary_color: string;
  secondary_color: string;
  table_header_color: string;
  totals_color: string;
} {
  return {
    color_theme_key: theme.key,
    primary_color: theme.gradient.from,
    secondary_color: theme.recipient_block_background,
    table_header_color: theme.table_header_color,
    totals_color: theme.totals_accent_color,
  };
}

/** @deprecated Use applyColorThemeToColorColumns */
export function applyDocumentStyleToColorColumns(theme: IncomeColorThemePreset): {
  document_style_key: string;
  primary_color: string;
  secondary_color: string;
  table_header_color: string;
  totals_color: string;
} {
  const cols = applyColorThemeToColorColumns(theme);
  return {
    document_style_key: theme.key,
    primary_color: cols.primary_color,
    secondary_color: cols.secondary_color,
    table_header_color: cols.table_header_color,
    totals_color: cols.totals_color,
  };
}

export function applyDocumentStyleTemplateKey(
  styleKey: IncomeDocumentStyleTemplateKey,
): { document_style_key: IncomeDocumentStyleTemplateKey } {
  return { document_style_key: styleKey };
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
  const styleTemplate = resolveDocumentStyleTemplate(styleKey)!;
  const colorThemeKey = resolveColorThemeKeyForRow(row);
  const colorTheme = resolveColorThemePreset(colorThemeKey)!;
  const layoutKey = resolveEffectiveLayoutTemplateKey(row);
  const logoSizeKey = resolveLogoSizeKey(row.logo_size_key);
  const colors = applyColorThemeToColorColumns(colorTheme);

  return {
    document_style_key: styleKey,
    document_style_template: {
      ...styleTemplate,
      mini_preview_markup: buildStyleMiniPreview(styleKey, colorTheme),
    },
    color_theme_key: colorThemeKey,
    color_theme: {
      ...colorTheme,
      mini_preview_markup: buildThemeMiniPreview(colorTheme),
    },
    layout_template_key: layoutKey,
    logo_size_key: logoSizeKey,
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

export function resolveLogoSizeDimensions(logoSizeKey: IncomeLogoSizeKey): {
  maxWidthPx: number;
  maxHeightPx: number;
} {
  const opt = INCOME_LOGO_SIZE_OPTIONS.find((o) => o.key === logoSizeKey) ?? INCOME_LOGO_SIZE_OPTIONS[1]!;
  return { maxWidthPx: opt.preview_max_width_px, maxHeightPx: opt.preview_max_height_px };
}

export function formatDocumentNumberDisplay(numberPreview: string | null | undefined): string {
  const n = String(numberPreview ?? '').trim();
  return n || 'טיוטה';
}

const INCOME_EMAIL_TEMPLATE_TOKENS: IncomeEmailTemplateToken[] = [
  {
    key: 'document_type',
    label: 'סוג מסמך',
    token: '{{document_type}}',
    example_value: 'הצעת מחיר',
  },
  {
    key: 'document_number',
    label: 'מספר מסמך',
    token: '{{document_number}}',
    example_value: 'טיוטה',
  },
  {
    key: 'client_name',
    label: 'שם לקוח',
    token: '{{client_name}}',
    example_value: 'לקוח לדוגמה',
  },
  {
    key: 'business_name',
    label: 'שם העסק',
    token: '{{business_name}}',
    example_value: 'שם העסק',
  },
];

export function getEmailTemplateTokens(): IncomeEmailTemplateToken[] {
  return INCOME_EMAIL_TEMPLATE_TOKENS.map((token) => ({ ...token }));
}

export function renderEmailTemplateFriendly(
  template: string | null | undefined,
  tokens: IncomeEmailTemplateToken[] = INCOME_EMAIL_TEMPLATE_TOKENS,
): string {
  if (!template?.trim()) return '';
  let result = template;
  for (const entry of tokens) {
    result = result.split(entry.token).join(entry.example_value);
  }
  return result;
}

export function encodeEmailTemplateFromFriendly(
  friendly: string | null | undefined,
  tokens: IncomeEmailTemplateToken[] = INCOME_EMAIL_TEMPLATE_TOKENS,
): string | null {
  if (friendly === null || friendly === undefined) return null;
  const trimmed = friendly.trim();
  if (!trimmed) return null;
  let result = trimmed;
  const sorted = [...tokens].sort((a, b) => b.example_value.length - a.example_value.length);
  for (const entry of sorted) {
    result = result.split(entry.example_value).join(entry.token);
  }
  return result;
}

export function buildEmailTemplatePreview(
  subjectTemplate: string | null,
  bodyTemplate: string | null,
  tokens: IncomeEmailTemplateToken[] = INCOME_EMAIL_TEMPLATE_TOKENS,
): { subject_preview: string; body_preview: string } {
  return {
    subject_preview: renderEmailTemplateFriendly(subjectTemplate, tokens),
    body_preview: renderEmailTemplateFriendly(bodyTemplate, tokens),
  };
}

export function buildEmailTemplateEditor(
  subjectTemplate: string | null,
  bodyTemplate: string | null,
  tokens: IncomeEmailTemplateToken[] = INCOME_EMAIL_TEMPLATE_TOKENS,
): {
  subject_friendly: string;
  body_friendly: string;
  helper_text: string;
} {
  return {
    subject_friendly: renderEmailTemplateFriendly(subjectTemplate, tokens),
    body_friendly: renderEmailTemplateFriendly(bodyTemplate, tokens),
    helper_text: 'אפשר להוסיף משתנים כמו סוג מסמך ומספר מסמך.',
  };
}
