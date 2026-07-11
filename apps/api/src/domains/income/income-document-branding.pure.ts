import { badRequest } from '../../shared/errors.js';
import type {
  IncomeBrandingClientBlockPosition,
  IncomeBrandingDisplayOptionControl,
  IncomeBrandingDisplayOptions,
  IncomeBrandingIssuerIdentityPreview,
  IncomeBrandingPaymentMethod,
  IncomeBrandingPaymentSettingsPanel,
  IncomeBrandingStudioNavSection,
  IncomeBrandingStudioSectionKey,
  IncomeColorThemePresetStudio,
  IncomeDocumentTypeStyleDefault,
  IncomeDocumentTypeStyleGroup,
  IncomeDocumentTypeStyleGroupKey,
  IncomeDocumentTypeStyleOverride,
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
export const DEFAULT_COLOR_THEME_KEY = 'nodexpro_premium';
export const DEFAULT_LOGO_SIZE_KEY: IncomeLogoSizeKey = 'medium';
export const DEFAULT_PRIMARY_COLOR = '#5B4DFF';
export const DEFAULT_SECONDARY_COLOR = '#6A5BFF';

export const INCOME_DOCUMENT_TYPE_STYLE_GROUP_KEYS = [
  'quote_deal',
  'tax_group',
  'receipt',
  'credit',
] as const satisfies readonly IncomeDocumentTypeStyleGroupKey[];

export const LEGACY_COLOR_KEY_TO_THEME: Record<string, string> = {
  classic_blue: 'dark_blue',
  soft_green: 'green',
  elegant_purple: 'pastel_purple',
  professional_teal: 'teal',
  soft_gold: 'yellow',
  business_gray: 'gray',
  calm_red: 'red',
  nodexpro_gradient: 'bright_blue',
  modern_blue: 'dark_blue',
  executive_navy: 'dark_blue',
  elegant_gold: 'yellow',
  emerald: 'teal',
  royal_purple: 'pastel_purple',
  clean_gray: 'gray',
  minimal_light: 'pale_blue',
};

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
  { key: 'check', label: "צ'ק", enabled: false },
  { key: 'cash', label: 'מזומן', enabled: false },
  { key: 'paypal', label: 'PayPal', enabled: false },
  { key: 'bit', label: 'Bit', enabled: false },
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
<div class="nx-studio-style-mini__classic-columns"><span class="nx-studio-style-mini__logo"></span><span class="nx-studio-style-mini__recipient" style="border-inline-start-color:${accent}"></span></div>
<div class="nx-studio-style-mini__banner" style="background:${grad}"></div>
<div class="nx-studio-style-mini__table" style="background:${header}"></div>
<div class="nx-studio-style-mini__totals" style="border-top-color:${totals}"></div>
</div>`;
}

function buildAccentColorTheme(
  key: string,
  label: string,
  accentHex: string,
  options?: { background?: string; border?: string; textOnLight?: string; pale?: boolean },
): Omit<IncomeColorThemePreset, 'mini_preview_markup'> {
  const accent = accentHex.toLowerCase();
  const background = options?.background ?? (options?.pale ? accent : '#ffffff');
  const border = options?.border ?? '#d1d5db';
  const textOnLight = options?.textOnLight ?? '#111827';
  const useDarkHeaderText = options?.pale === true || key === 'yellow' || key === 'pale_peach';
  return {
    key,
    label,
    gradient: { from: accent, to: accent },
    table_header_color: accent,
    totals_accent_color: accent,
    recipient_accent_color: accent,
    recipient_block_background: background,
    recipient_block_border: border,
    text_on_dark: useDarkHeaderText ? textOnLight : '#ffffff',
    text_on_light: textOnLight,
    print_safe: true,
  };
}

const COLOR_THEME_DEFS: Omit<IncomeColorThemePreset, 'mini_preview_markup'>[] = [
  {
    key: 'nodexpro_premium',
    label: 'NodexPro Premium',
    gradient: { from: '#5B4DFF', to: '#6A5BFF' },
    table_header_color: '#5B4DFF',
    totals_accent_color: '#5B4DFF',
    recipient_accent_color: '#5B4DFF',
    recipient_block_background: '#F8F9FD',
    recipient_block_border: '#E6E8F2',
    text_on_dark: '#ffffff',
    text_on_light: '#1C2333',
    print_safe: true,
  },
  {
    key: 'black_white',
    label: 'שחור לבן',
    gradient: { from: '#111827', to: '#111827' },
    table_header_color: '#111827',
    totals_accent_color: '#111827',
    recipient_accent_color: '#111827',
    recipient_block_background: '#ffffff',
    recipient_block_border: '#d1d5db',
    text_on_dark: '#ffffff',
    text_on_light: '#111827',
    print_safe: true,
  },
  buildAccentColorTheme('pastel_purple', 'Pastel Purple', '#D8D0FF', { pale: true }),
  buildAccentColorTheme('teal', 'Teal', '#3BB6C6'),
  buildAccentColorTheme('dark_blue', 'Dark Blue', '#1F559A'),
  buildAccentColorTheme('gray', 'Gray', '#94A3B8'),
  buildAccentColorTheme('pale_peach', 'Pale Peach', '#F8DED6', { pale: true }),
  buildAccentColorTheme('pale_green', 'Pale Green', '#DDF5DF', { pale: true }),
  buildAccentColorTheme('pale_mint', 'Pale Mint', '#D9F1EF', { pale: true }),
  buildAccentColorTheme('pale_blue', 'Pale Blue', '#DDEAF7', { pale: true }),
  buildAccentColorTheme('red', 'Red', '#FF3B4A'),
  buildAccentColorTheme('bright_blue', 'Bright Blue', '#5B9BEF'),
  buildAccentColorTheme('green', 'Green', '#58C978'),
  buildAccentColorTheme('yellow', 'Yellow', '#FFE384', { pale: true }),
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
    description: 'לקוח משמאל · עסק מימין · כותרת מסמך בשורה נפרדת',
    default_layout_template_key: 'logo_left_client_right',
  },
  {
    key: 'modern',
    label: 'מודרני',
    description: 'עסק למעלה · לקוח מתחת · ריווח פתוח בלי בלוק צבע לכותרת',
    default_layout_template_key: 'logo_left_client_right',
  },
  {
    key: 'elegant',
    label: 'אלגנטי',
    description: 'לוגו גדול · עסק מימין · לקוח משמאל · חתימה בכותרת',
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

const STUDIO_COLOR_THEME_LABELS: Record<string, string> = {
  black_white: 'שחור לבן',
  pastel_purple: 'Pastel Purple',
  teal: 'Teal',
  dark_blue: 'Dark Blue',
  gray: 'Gray',
  pale_peach: 'Pale Peach',
  pale_green: 'Pale Green',
  pale_mint: 'Pale Mint',
  pale_blue: 'Pale Blue',
  red: 'Red',
  bright_blue: 'Bright Blue',
  green: 'Green',
  yellow: 'Yellow',
};

export function getStudioColorThemePresets(): IncomeColorThemePresetStudio[] {
  return INCOME_COLOR_THEME_PRESETS.map((preset) => ({
    ...preset,
    gradient: { ...preset.gradient },
    mini_preview_markup: buildThemeMiniPreview(preset),
    studio_label: STUDIO_COLOR_THEME_LABELS[preset.key] ?? preset.label,
  }));
}

export const INCOME_DOCUMENT_TYPE_STYLE_GROUP_DEFS: Array<
  Omit<IncomeDocumentTypeStyleGroup, 'effective_document_style_key' | 'effective_color_theme_key'>
> = [
  {
    group_key: 'quote_deal',
    group_label: 'הצעת מחיר · חשבון עסקה',
    types_label: 'הצעת מחיר, חשבון עסקה',
    sample_document_type_label: 'הצעת מחיר',
  },
  {
    group_key: 'tax_group',
    group_label: 'חשבונית מס · חשבונית מס/קבלה',
    types_label: 'חשבונית מס, חשבונית מס/קבלה',
    sample_document_type_label: 'חשבונית מס',
  },
  {
    group_key: 'receipt',
    group_label: 'קבלה',
    types_label: 'קבלה',
    sample_document_type_label: 'קבלה',
  },
  {
    group_key: 'credit',
    group_label: 'זיכוי',
    types_label: 'חשבונית מס זיכוי',
    sample_document_type_label: 'זיכוי',
  },
];

export const INCOME_DOCUMENT_TYPE_STYLE_DEFAULTS: IncomeDocumentTypeStyleDefault[] = [
  { document_type_key: 'quote', document_type_label: 'הצעת מחיר', default_document_style_key: 'classic', default_color_theme_key: 'nodexpro_premium' },
  { document_type_key: 'tax_invoice', document_type_label: 'חשבונית מס', default_document_style_key: 'classic', default_color_theme_key: 'nodexpro_premium' },
  { document_type_key: 'receipt', document_type_label: 'קבלה', default_document_style_key: 'classic', default_color_theme_key: 'nodexpro_premium' },
  { document_type_key: 'credit_note', document_type_label: 'זיכוי', default_document_style_key: 'classic', default_color_theme_key: 'nodexpro_premium' },
];

export function getDocumentTypeStyleDefaults(): IncomeDocumentTypeStyleDefault[] {
  return INCOME_DOCUMENT_TYPE_STYLE_DEFAULTS.map((d) => ({ ...d }));
}

export function normalizeDocumentTypeStyleGroupKey(
  value: unknown,
): IncomeDocumentTypeStyleGroupKey | null {
  const key = String(value ?? '').trim();
  return INCOME_DOCUMENT_TYPE_STYLE_GROUP_KEYS.includes(key as IncomeDocumentTypeStyleGroupKey)
    ? (key as IncomeDocumentTypeStyleGroupKey)
    : null;
}

export function resolveDocumentTypeStyleGroupKey(documentType: string): IncomeDocumentTypeStyleGroupKey {
  const key = String(documentType ?? '').trim();
  if (key === 'tax_invoice' || key === 'tax_invoice_receipt') return 'tax_group';
  if (key === 'receipt') return 'receipt';
  if (key === 'credit_tax_invoice' || key === 'credit_note') return 'credit';
  if (key === 'deal_invoice' || key === 'quote') return 'quote_deal';
  return 'quote_deal';
}

export function normalizeColorThemeKey(key: string): string {
  const trimmed = String(key ?? '').trim();
  if (!trimmed) return DEFAULT_COLOR_THEME_KEY;
  if (INCOME_COLOR_THEME_PRESETS.some((preset) => preset.key === trimmed)) return trimmed;
  return LEGACY_COLOR_KEY_TO_THEME[trimmed] ?? DEFAULT_COLOR_THEME_KEY;
}

/** Legacy system default before NodexPro Premium — treat as premium at render time. */
export function normalizeLegacyDocumentColorThemeKey(key: string): string {
  const normalized = normalizeColorThemeKey(key);
  return normalized === 'black_white' ? DEFAULT_COLOR_THEME_KEY : normalized;
}

export function parseDocumentTypeStyleOverridesJson(
  raw: unknown,
): Partial<Record<IncomeDocumentTypeStyleGroupKey, IncomeDocumentTypeStyleOverride>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const out: Partial<Record<IncomeDocumentTypeStyleGroupKey, IncomeDocumentTypeStyleOverride>> = {};
  for (const groupKey of INCOME_DOCUMENT_TYPE_STYLE_GROUP_KEYS) {
    const entry = source[groupKey];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const styleRaw = String(row.document_style_key ?? '').trim();
    const colorRaw = String(row.color_theme_key ?? '').trim();
    if (!styleRaw && !colorRaw) continue;
    const document_style_key = normalizeStudioDocumentStyleKey(styleRaw || DEFAULT_DOCUMENT_STYLE_KEY);
    const color_theme_key = normalizeColorThemeKey(colorRaw || DEFAULT_COLOR_THEME_KEY);
    if (!resolveDocumentStyleTemplate(document_style_key) || !resolveColorThemePreset(color_theme_key)) continue;
    out[groupKey] = { document_style_key, color_theme_key };
  }
  return out;
}

export function serializeDocumentTypeStyleOverridesJson(
  overrides: Partial<Record<IncomeDocumentTypeStyleGroupKey, IncomeDocumentTypeStyleOverride>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const groupKey of INCOME_DOCUMENT_TYPE_STYLE_GROUP_KEYS) {
    const entry = overrides[groupKey];
    if (!entry) continue;
    out[groupKey] = {
      document_style_key: entry.document_style_key,
      color_theme_key: entry.color_theme_key,
    };
  }
  return out;
}

export function resolveEffectiveStyleForGroup(
  groupKey: IncomeDocumentTypeStyleGroupKey,
  overrides: Partial<Record<IncomeDocumentTypeStyleGroupKey, IncomeDocumentTypeStyleOverride>>,
): IncomeDocumentTypeStyleOverride {
  const stored = overrides[groupKey];
  if (stored) {
    return {
      document_style_key: normalizeStudioDocumentStyleKey(stored.document_style_key),
      color_theme_key: normalizeLegacyDocumentColorThemeKey(stored.color_theme_key),
    };
  }
  return {
    document_style_key: DEFAULT_DOCUMENT_STYLE_KEY,
    color_theme_key: DEFAULT_COLOR_THEME_KEY,
  };
}

export function buildDocumentTypeStyleGroups(
  overrides: Partial<Record<IncomeDocumentTypeStyleGroupKey, IncomeDocumentTypeStyleOverride>>,
): IncomeDocumentTypeStyleGroup[] {
  return INCOME_DOCUMENT_TYPE_STYLE_GROUP_DEFS.map((def) => {
    const effective = resolveEffectiveStyleForGroup(def.group_key, overrides);
    return {
      ...def,
      effective_document_style_key: effective.document_style_key,
      effective_color_theme_key: effective.color_theme_key,
    };
  });
}

export function mergeDocumentTypeStyleOverrides(
  current: Partial<Record<IncomeDocumentTypeStyleGroupKey, IncomeDocumentTypeStyleOverride>>,
  incoming: Partial<Record<IncomeDocumentTypeStyleGroupKey, IncomeDocumentTypeStyleOverride>>,
): Partial<Record<IncomeDocumentTypeStyleGroupKey, IncomeDocumentTypeStyleOverride>> {
  return { ...current, ...incoming };
}

export function applyDocumentTypeStyleOverridesFromBody(
  row: IncomeBrandingProfileRow,
  body: Record<string, unknown>,
): Partial<Record<IncomeDocumentTypeStyleGroupKey, IncomeDocumentTypeStyleOverride>> {
  let overrides = parseDocumentTypeStyleOverridesJson(row.document_type_style_overrides);
  if (
    body.document_type_style_overrides &&
    typeof body.document_type_style_overrides === 'object' &&
    !Array.isArray(body.document_type_style_overrides)
  ) {
    overrides = mergeDocumentTypeStyleOverrides(
      overrides,
      parseDocumentTypeStyleOverridesJson(body.document_type_style_overrides),
    );
  }
  const groupKey =
    normalizeDocumentTypeStyleGroupKey(body.selected_document_type_group_key) ?? 'quote_deal';
  const hasStyle = body.document_style_key !== undefined;
  const hasColor = body.color_theme_key !== undefined || body.color_preset_key !== undefined;
  if (hasStyle || hasColor) {
    const current = resolveEffectiveStyleForGroup(groupKey, overrides);
    const document_style_key = hasStyle
      ? normalizeStudioDocumentStyleKey(String(body.document_style_key))
      : current.document_style_key;
    const color_theme_key = hasColor
      ? String(body.color_theme_key ?? body.color_preset_key ?? '').trim()
      : current.color_theme_key;
    if (!resolveDocumentStyleTemplate(document_style_key)) {
      throw badRequest('document_style_key is invalid', 'BRANDING_DOCUMENT_STYLE_INVALID');
    }
    if (!resolveColorThemePreset(color_theme_key)) {
      throw badRequest('color_theme_key is invalid', 'BRANDING_COLOR_THEME_INVALID');
    }
    overrides = mergeDocumentTypeStyleOverrides(overrides, {
      [groupKey]: {
        document_style_key,
        color_theme_key: normalizeColorThemeKey(color_theme_key),
      },
    });
  }
  return overrides;
}

export function getStudioNavigationSections(): IncomeBrandingStudioNavSection[] {
  return [
    { key: 'document_style', label: 'סגנון מסמך', description: 'פריסת המסמך — קלאסי, מודרני או אלגנטי', icon_key: 'layout' },
    { key: 'branding', label: 'מיתוג', description: 'לוגו, חתימה וערכת צבעים', icon_key: 'palette' },
    { key: 'business', label: 'פרטי עסק', description: 'זהות העסק כפי שתופיע במסמך', icon_key: 'building' },
    { key: 'document_content', label: 'תוכן המסמך', description: 'בחירת בלוקים שיוצגו במסמך', icon_key: 'blocks' },
    { key: 'payment', label: 'תשלום', description: 'אמצעי תשלום ופרטי חשבון', icon_key: 'payment' },
    { key: 'email', label: 'אימייל', description: 'תבנית שליחת מסמך ללקוח', icon_key: 'email' },
    { key: 'advanced', label: 'מתקדם', description: 'הגדרות PDF וטיפוגרפיה — בקרוב', icon_key: 'advanced' },
  ];
}

export function buildDisplayOptionControls(display: IncomeBrandingDisplayOptions): IncomeBrandingDisplayOptionControl[] {
  return [
    { key: 'show_logo', label: 'הצג לוגו', value: display.show_logo, draft_field: 'show_logo' },
    { key: 'show_signature', label: 'הצג חתימה', value: display.show_signature, draft_field: 'show_signature' },
    { key: 'show_footer', label: 'הצג כותרת תחתונה', value: display.show_footer, draft_field: 'show_footer' },
    { key: 'show_notes', label: 'הצג הערות', value: display.show_notes, draft_field: 'show_notes' },
    { key: 'show_payment_terms', label: 'הצג בלוק תשלום', value: display.show_payment_terms, draft_field: 'show_payment_terms' },
    { key: 'show_bank_details', label: 'הצג פרטי בנק', value: display.show_bank_details, draft_field: 'show_bank_details' },
    { key: 'show_due_date', label: 'הצג תאריך לתשלום', value: display.show_due_date, draft_field: 'show_due_date' },
    { key: 'show_vat_row', label: 'הצג סיכום מע״מ', value: display.show_vat_row, draft_field: 'show_vat_row' },
  ];
}

function parseBooleanBody(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function mergeDisplayOptionsFromStudioBody(
  body: Record<string, unknown>,
  current: IncomeBrandingDisplayOptions,
  clientPos: IncomeBrandingClientBlockPosition,
): IncomeBrandingDisplayOptions {
  const bool = (key: keyof IncomeBrandingDisplayOptions, fallback: boolean): boolean =>
    body[key] === undefined ? fallback : parseBooleanBody(body[key]);
  return {
    ...current,
    show_logo: bool('show_logo', current.show_logo),
    show_signature: bool('show_signature', current.show_signature),
    show_footer: bool('show_footer', current.show_footer),
    show_notes: bool('show_notes', current.show_notes),
    show_payment_terms: bool('show_payment_terms', current.show_payment_terms),
    show_bank_details: bool('show_bank_details', current.show_bank_details),
    show_due_date: bool('show_due_date', current.show_due_date),
    show_vat_row: bool('show_vat_row', current.show_vat_row),
    client_block_position: clientPos,
  };
}

export function mergePaymentMethodsFromStudioBody(
  body: Record<string, unknown>,
  methods: IncomeBrandingPaymentMethod[],
): IncomeBrandingPaymentMethod[] {
  return methods.map((m) => ({
    ...m,
    enabled:
      body[`payment_method_${m.key}`] === undefined
        ? m.enabled
        : parseBooleanBody(body[`payment_method_${m.key}`]),
  }));
}

export function buildPaymentSettingsPanel(params: {
  represented_client_id: string | null;
  issuer_business_id: string;
  payment_methods: IncomeBrandingPaymentMethod[];
}): IncomeBrandingPaymentSettingsPanel {
  const isOfficeRepresentative = Boolean(params.represented_client_id);
  const isClientBrandingProfile =
    isOfficeRepresentative && params.represented_client_id === params.issuer_business_id;
  const editable = !isOfficeRepresentative || isClientBrandingProfile;
  return {
    mode: isOfficeRepresentative ? 'represented_client' : 'issuer_profile',
    editable,
    warning_message: isOfficeRepresentative && !isClientBrandingProfile
      ? 'פרטי תשלום נלקחים מפרופיל הלקוח ב-Client Operations. עריכה כאן אינה זמינה במצב נציג משרד.'
      : null,
    payment_methods: params.payment_methods.map((m) => ({ ...m })),
  };
}

export function buildIssuerIdentityPreview(params: {
  display_name: string;
  tax_id: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  read_only: boolean;
  helper_text: string | null;
  sample_only_label?: string | null;
  source_badge_label?: string | null;
}): IncomeBrandingIssuerIdentityPreview {
  return {
    business_name: params.display_name,
    tax_id: params.tax_id,
    address: params.address,
    phone: params.phone,
    email: params.email,
    website: null,
    read_only: params.read_only,
    helper_text: params.helper_text,
    sample_only_label: params.sample_only_label ?? null,
    source_badge_label: params.source_badge_label ?? null,
  };
}

export const STUDIO_SAMPLE_ONLY_LABEL = 'תצוגת דוגמה בלבד';

export const STUDIO_SAMPLE_ISSUER = {
  display_name: 'שם העסק',
  tax_id: '123456789',
  address: 'רחוב העסק 1, תל אביב',
  phone: '03-1234567',
  email: 'office@example.com',
} as const;

export const STUDIO_SAMPLE_RECIPIENT = {
  display_name: 'לקוח לדוגמה',
  tax_id: '987654321',
  address: 'רחוב הלקוח 5',
  phone: '050-1234567',
  email: 'client@example.com',
} as const;

export function buildStudioSampleIssuerIdentityPreview(): IncomeBrandingIssuerIdentityPreview {
  return buildIssuerIdentityPreview({
    display_name: STUDIO_SAMPLE_ISSUER.display_name,
    tax_id: STUDIO_SAMPLE_ISSUER.tax_id,
    address: STUDIO_SAMPLE_ISSUER.address,
    phone: STUDIO_SAMPLE_ISSUER.phone,
    email: STUDIO_SAMPLE_ISSUER.email,
    read_only: true,
    helper_text:
      'פרטי העסק במסמך נלקחים מפרופיל העסק או מהלקוח המיוצג בעת הפקת מסמך — כאן מוצגת דוגמה בלבד.',
    sample_only_label: STUDIO_SAMPLE_ONLY_LABEL,
    source_badge_label: STUDIO_SAMPLE_ONLY_LABEL,
  });
}

export function buildStudioSampleLivePreview(params: {
  preview_html: string;
  sample_document_type_label?: string;
  sample_document_number_display?: string | null;
}): {
  visible: boolean;
  preview_html: string;
  sample_document_type_label: string;
  sample_document_number_display: string | null;
  sample_only_label: string;
  preview_footnote: string;
} {
  return {
    visible: true,
    preview_html: params.preview_html,
    sample_document_type_label: params.sample_document_type_label ?? 'הצעת מחיר',
    sample_document_number_display: params.sample_document_number_display ?? null,
    sample_only_label: STUDIO_SAMPLE_ONLY_LABEL,
    preview_footnote: 'המסמך הסופי נוצר בשרת.',
  };
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
  const trimmed = String(key ?? '').trim();
  if (!trimmed) return null;
  const normalized = LEGACY_COLOR_KEY_TO_THEME[trimmed] ?? trimmed;
  return INCOME_COLOR_THEME_PRESETS.find((p) => p.key === normalized) ?? null;
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
  if (explicit) {
    return normalizeLegacyDocumentColorThemeKey(normalizeColorThemeKey(explicit));
  }
  const styleRaw = String(row.document_style_key ?? '').trim();
  if (LEGACY_COLOR_KEYS.has(styleRaw)) {
    return normalizeColorThemeKey(LEGACY_COLOR_KEY_TO_THEME[styleRaw] ?? DEFAULT_COLOR_THEME_KEY);
  }
  return normalizeColorThemeKey(
    matchColorThemeKeyFromLegacyColors(row.primary_color, row.table_header_color, row.totals_color),
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
  const p = coerceHexColor(primaryColor, DEFAULT_PRIMARY_COLOR).toLowerCase();
  const t = coerceHexColor(tableHeaderColor, DEFAULT_PRIMARY_COLOR).toLowerCase();
  const tot = coerceHexColor(totalsColor, DEFAULT_PRIMARY_COLOR).toLowerCase();

  if (p === t && t === tot && p === '#1f4b99') {
    return DEFAULT_COLOR_THEME_KEY;
  }

  const legacyMap: Record<string, string> = {
    '#5b4dff': 'nodexpro_premium',
    '#6a5bff': 'nodexpro_premium',
    '#7a6dff': 'nodexpro_premium',
    '#111827': 'black_white',
    '#1f559a': 'dark_blue',
    '#5b9bef': 'bright_blue',
    '#3bb6c6': 'teal',
    '#58c978': 'green',
    '#ff3b4a': 'red',
    '#ffe384': 'yellow',
    '#d8d0ff': 'pastel_purple',
    '#94a3b8': 'gray',
    '#f8ded6': 'pale_peach',
    '#ddf5df': 'pale_green',
    '#d9f1ef': 'pale_mint',
    '#ddeaf7': 'pale_blue',
    '#1f4b99': 'nodexpro_premium',
    '#1e5c4a': 'teal',
    '#475569': 'gray',
    '#64748b': 'gray',
    '#4c3d6e': 'pastel_purple',
    '#8a6d3b': 'yellow',
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
  const byKey = new Map<string, IncomeBrandingPaymentMethod>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const o = item as Record<string, unknown>;
      const key = typeof o.key === 'string' ? o.key.trim() : '';
      if (!key) continue;
      byKey.set(key, {
        key,
        label: typeof o.label === 'string' && o.label.trim() ? o.label.trim() : key,
        enabled: o.enabled === true,
      });
    }
  }
  return DEFAULT_PAYMENT_METHODS.map((defaultMethod) => {
    const existing = byKey.get(defaultMethod.key);
    return existing
      ? { ...defaultMethod, ...existing, label: existing.label || defaultMethod.label }
      : { ...defaultMethod };
  });
}

export function serializePaymentMethodsJson(methods: IncomeBrandingPaymentMethod[]): unknown[] {
  return methods.map((m) => ({ key: m.key, label: m.label, enabled: m.enabled }));
}

export function applyBrandingStyleToResolvedProfile(
  base: IncomeBrandingResolvedProfile,
  styleKey: IncomeDocumentStyleTemplateKey,
  colorThemeKey: string,
): IncomeBrandingResolvedProfile {
  const normalizedStyle = normalizeStudioDocumentStyleKey(styleKey);
  const theme = resolveColorThemePreset(colorThemeKey)!;
  const styleTemplate = resolveDocumentStyleTemplate(normalizedStyle)!;
  const colors = applyColorThemeToColorColumns(theme);
  return {
    ...base,
    document_style_key: normalizedStyle,
    document_style_template: {
      ...styleTemplate,
      mini_preview_markup: buildStyleMiniPreview(normalizedStyle, theme),
    },
    color_theme_key: theme.key,
    color_theme: {
      ...theme,
      mini_preview_markup: buildThemeMiniPreview(theme),
    },
    primary_color: colors.primary_color,
    secondary_color: colors.secondary_color,
    table_header_color: colors.table_header_color,
    totals_color: colors.totals_color,
  };
}

export function resolveBrandingProfileForDocumentTypeGroup(
  row: IncomeBrandingProfileRow,
  assets: { logo_data_url: string | null; signature_data_url: string | null },
  groupKey: IncomeDocumentTypeStyleGroupKey,
  draftOverrides?: Partial<Record<IncomeDocumentTypeStyleGroupKey, IncomeDocumentTypeStyleOverride>>,
): IncomeBrandingResolvedProfile {
  const base = resolveBrandingProfile(row, assets);
  const overrides =
    draftOverrides ?? parseDocumentTypeStyleOverridesJson(row.document_type_style_overrides);
  const effective = resolveEffectiveStyleForGroup(groupKey, overrides);
  return applyBrandingStyleToResolvedProfile(
    base,
    effective.document_style_key,
    effective.color_theme_key,
  );
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
    payment_instructions: row.payment_instructions?.trim() ? row.payment_instructions.trim() : null,
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

/** Single palette for branded preview HTML — table, totals, banner, accents must match. */
export function resolveBrandingPreviewThemePalette(theme: IncomeColorThemePreset) {
  return {
    gradient_css: gradientCss(theme.gradient),
    table_header_color: theme.table_header_color,
    totals_accent_color: theme.totals_accent_color,
    recipient_accent_color: theme.recipient_accent_color,
    recipient_block_background: theme.recipient_block_background,
    recipient_block_border: theme.recipient_block_border,
    text_on_dark: theme.text_on_dark,
    text_on_light: theme.text_on_light,
  };
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
