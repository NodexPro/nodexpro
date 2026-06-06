export const INCOME_COMMAND_UPDATE_BRANDING_PROFILE = 'update_income_document_branding_profile' as const;
export const INCOME_COMMAND_UPDATE_BRANDING_PROFILE_PREVIEW_DRAFT =
  'update_income_document_branding_profile_preview_draft' as const;
export const INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO = 'upload_income_document_logo' as const;
export const INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE = 'upload_income_document_signature' as const;

export type IncomeBrandingClientBlockPosition = 'left' | 'right';

export type IncomeBrandingQuantityPosition = 'before_description' | 'after_description';

export type IncomeDocumentStyleTemplateKey = 'classic' | 'modern' | 'elegant';

/** Legacy DB value — resolved to `modern` in studio/preview; not offered in UI. */
export type IncomeDocumentStyleTemplateKeyLegacy = IncomeDocumentStyleTemplateKey | 'minimal';

export const STUDIO_DOCUMENT_STYLE_KEYS: IncomeDocumentStyleTemplateKey[] = [
  'classic',
  'modern',
  'elegant',
];

export type IncomeLayoutTemplateKey =
  | 'logo_left_client_right'
  | 'logo_top_client_below'
  | 'israeli_classic'
  | 'logo_right_client_left';

export type IncomeLogoSizeKey = 'small' | 'medium' | 'large';

export type IncomeBrandingStudioSectionKey =
  | 'document_style'
  | 'branding'
  | 'business'
  | 'document_content'
  | 'payment'
  | 'email'
  | 'advanced';

export type IncomeBrandingStudioNavSection = {
  key: IncomeBrandingStudioSectionKey;
  label: string;
  description: string;
  icon_key: string;
};

export type IncomeBrandingDisplayOptionControl = {
  key: string;
  label: string;
  value: boolean;
  draft_field: string;
};

export type IncomeBrandingIssuerIdentityPreview = {
  business_name: string;
  tax_id: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  read_only: boolean;
  helper_text: string | null;
  sample_only_label: string | null;
  source_badge_label: string | null;
};

export type IncomeBrandingPaymentSettingsPanel = {
  mode: 'issuer_profile' | 'represented_client';
  editable: boolean;
  warning_message: string | null;
  payment_methods: IncomeBrandingPaymentMethod[];
};

export type IncomeDocumentTypeStyleDefault = {
  document_type_key: string;
  document_type_label: string;
  default_document_style_key: IncomeDocumentStyleTemplateKey;
  default_color_theme_key: string;
};

export type IncomeDocumentTypeStyleGroupKey = 'quote_deal' | 'tax_group' | 'receipt' | 'credit';

export type IncomeDocumentTypeStyleOverride = {
  document_style_key: IncomeDocumentStyleTemplateKey;
  color_theme_key: string;
};

export type IncomeDocumentTypeStyleGroup = {
  group_key: IncomeDocumentTypeStyleGroupKey;
  group_label: string;
  types_label: string;
  sample_document_type_label: string;
  effective_document_style_key: IncomeDocumentStyleTemplateKey;
  effective_color_theme_key: string;
};

export type IncomeColorThemePresetStudio = IncomeColorThemePreset & {
  studio_label: string;
};

export type IncomeBrandingDisplayOptions = {
  show_logo: boolean;
  show_business_address: boolean;
  show_business_phone: boolean;
  show_business_email: boolean;
  show_business_tax_id: boolean;
  show_due_date: boolean;
  show_payment_terms: boolean;
  show_signature: boolean;
  show_footer: boolean;
  show_bank_details: boolean;
  show_notes: boolean;
  show_item_index: boolean;
  show_discount_row: boolean;
  show_vat_row: boolean;
  show_currency: boolean;
  quantity_position: IncomeBrandingQuantityPosition;
  client_block_position: IncomeBrandingClientBlockPosition;
};

export type IncomeBrandingPaymentMethod = {
  key: string;
  label: string;
  enabled: boolean;
};

export type IncomeDocumentStyleGradient = {
  from: string;
  to: string;
};

/** Layout archetype — קלאסי / מודרני / אלגנטי / מינימלי */
export type IncomeDocumentStyleTemplate = {
  key: IncomeDocumentStyleTemplateKey;
  label: string;
  description: string;
  default_layout_template_key: IncomeLayoutTemplateKey;
  mini_preview_markup: string;
};

/** Color theme — gradient, table, totals, recipient accent */
export type IncomeColorThemePreset = {
  key: string;
  label: string;
  gradient: IncomeDocumentStyleGradient;
  table_header_color: string;
  totals_accent_color: string;
  recipient_accent_color: string;
  recipient_block_background: string;
  recipient_block_border: string;
  text_on_dark: string;
  text_on_light: string;
  print_safe: boolean;
  mini_preview_markup: string;
};

export type IncomeLayoutTemplate = {
  key: IncomeLayoutTemplateKey;
  label: string;
  mini_preview_markup: string;
  advanced_only: boolean;
};

export type IncomeLogoSizeOption = {
  key: IncomeLogoSizeKey;
  label: string;
  preview_max_width_px: number;
  preview_max_height_px: number;
};

/** @deprecated Use IncomeColorThemePreset — kept for transitional imports */
export type IncomeDocumentStylePreset = IncomeColorThemePreset;

export type IncomeBrandingProfileRow = {
  id: string;
  organization_id: string;
  issuer_business_id: string;
  represented_client_id: string | null;
  logo_file_asset_id: string | null;
  signature_file_asset_id: string | null;
  company_subtitle: string | null;
  document_style_key: string;
  color_theme_key?: string;
  layout_template_key?: string | null;
  logo_size_key?: string;
  primary_color: string;
  secondary_color: string;
  table_header_color: string;
  totals_color: string;
  client_block_position: IncomeBrandingClientBlockPosition;
  footer_text: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  bank_account: string | null;
  swift: string | null;
  iban: string | null;
  payment_instructions: string | null;
  email_subject_template: string | null;
  email_body_template: string | null;
  customer_notes: string | null;
  terms_and_conditions: string | null;
  display_options: unknown;
  payment_methods: unknown;
  document_attachments: unknown;
  default_payment_terms: unknown;
  document_type_style_overrides?: unknown;
};

export type IncomeBrandingResolvedProfile = {
  document_style_key: IncomeDocumentStyleTemplateKey;
  document_style_template: IncomeDocumentStyleTemplate;
  color_theme_key: string;
  color_theme: IncomeColorThemePreset;
  layout_template_key: IncomeLayoutTemplateKey;
  logo_size_key: IncomeLogoSizeKey;
  company_subtitle: string | null;
  primary_color: string;
  secondary_color: string;
  table_header_color: string;
  totals_color: string;
  client_block_position: IncomeBrandingClientBlockPosition;
  footer_text: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  bank_account: string | null;
  swift: string | null;
  iban: string | null;
  payment_instructions: string | null;
  email_subject_template: string | null;
  email_body_template: string | null;
  customer_notes: string | null;
  terms_and_conditions: string | null;
  display_options: IncomeBrandingDisplayOptions;
  payment_methods: IncomeBrandingPaymentMethod[];
  logo_data_url: string | null;
  signature_data_url: string | null;
};

export type IncomeDocumentBrandingField = {
  key: string;
  label: string;
  input_type: 'text' | 'textarea' | 'boolean' | 'select' | 'document_style';
  value: string | boolean;
  options?: { value: string; label: string }[];
  visible: boolean;
  editable: boolean;
  disabled_reason: string | null;
  hint: string | null;
};

export type IncomeDocumentBrandingTab = {
  key: string;
  label: string;
  fields: IncomeDocumentBrandingField[];
};

export type IncomeDocumentBrandingAssetSlot = {
  label: string;
  file_asset_id: string | null;
  preview_data_url: string | null;
  upload_command: string;
  allowed_actions: string[];
  hint: string | null;
  recommended_size_hint: string | null;
  can_remove: boolean;
};

export type IncomeDocumentBrandingStudioLivePreview = {
  visible: boolean;
  preview_html: string;
  sample_document_type_label: string;
  sample_document_number_display: string | null;
  sample_only_label: string | null;
  preview_footnote: string | null;
};

export type IncomeEmailTemplateToken = {
  key: string;
  label: string;
  token: string;
  example_value: string;
};

export type IncomeEmailTemplateEditor = {
  subject_friendly: string;
  body_friendly: string;
  helper_text: string;
};

export type IncomeEmailTemplatePreview = {
  subject_preview: string;
  body_preview: string;
};

/** Ephemeral preview result — no DB write. */
export type IncomeDocumentBrandingStudioPreviewDraftResult = {
  studio_live_preview: IncomeDocumentBrandingStudioLivePreview;
  selected_document_type_group_key: IncomeDocumentTypeStyleGroupKey;
  document_type_style_groups: IncomeDocumentTypeStyleGroup[];
  selected_document_style_key: IncomeDocumentStyleTemplateKey;
  selected_color_theme_key: string;
  selected_layout_template_key: IncomeLayoutTemplateKey | null;
  selected_logo_size_key: IncomeLogoSizeKey;
  document_style_templates: IncomeDocumentStyleTemplate[];
  email_template_preview: IncomeEmailTemplatePreview;
};

export type IncomeDocumentBrandingStudioFields = {
  show_logo: boolean;
  company_subtitle: string | null;
  show_signature: boolean;
  footer_text: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  bank_account: string | null;
  iban: string | null;
  swift: string | null;
  payment_instructions: string | null;
  email_subject_template: string | null;
  email_body_template: string | null;
  customer_notes: string | null;
  terms_and_conditions: string | null;
};

export type IncomeDocumentBrandingStudio = {
  navigation_sections: IncomeBrandingStudioNavSection[];
  document_style_templates: IncomeDocumentStyleTemplate[];
  color_theme_presets: IncomeColorThemePreset[];
  studio_color_theme_presets: IncomeColorThemePresetStudio[];
  display_option_controls: IncomeBrandingDisplayOptionControl[];
  issuer_identity_preview: IncomeBrandingIssuerIdentityPreview;
  payment_settings_panel: IncomeBrandingPaymentSettingsPanel;
  /** @deprecated Use document_type_style_groups */
  document_type_style_defaults: IncomeDocumentTypeStyleDefault[];
  document_type_style_groups: IncomeDocumentTypeStyleGroup[];
  selected_document_type_group_key: IncomeDocumentTypeStyleGroupKey;
  document_type_style_overrides: Partial<
    Record<IncomeDocumentTypeStyleGroupKey, IncomeDocumentTypeStyleOverride>
  >;
  layout_templates: IncomeLayoutTemplate[];
  logo_size_options: IncomeLogoSizeOption[];
  selected_document_style_key: IncomeDocumentStyleTemplateKey;
  selected_color_theme_key: string;
  selected_layout_template_key: IncomeLayoutTemplateKey | null;
  selected_logo_size_key: IncomeLogoSizeKey;
  advanced_layout_visible: boolean;
  studio_live_preview: IncomeDocumentBrandingStudioLivePreview;
  email_template_tokens: IncomeEmailTemplateToken[];
  email_template_editor: IncomeEmailTemplateEditor;
  email_template_preview: IncomeEmailTemplatePreview;
  fields: IncomeDocumentBrandingStudioFields;
  save_section_key: 'modal';
  save_command: typeof INCOME_COMMAND_UPDATE_BRANDING_PROFILE;
  preview_draft_command: typeof INCOME_COMMAND_UPDATE_BRANDING_PROFILE_PREVIEW_DRAFT;
};

export type IncomeDocumentBrandingProfileAggregate = {
  profile_id: string;
  title: string;
  document_branding_studio: IncomeDocumentBrandingStudio;
  logo: IncomeDocumentBrandingAssetSlot;
  signature: IncomeDocumentBrandingAssetSlot;
  allowed_actions: string[];
  /** @deprecated Studio replaces tabs */
  tabs?: IncomeDocumentBrandingTab[];
  /** @deprecated Use document_branding_studio.color_theme_presets */
  document_style_presets?: IncomeColorThemePreset[];
  /** @deprecated Use document_branding_studio.selected_color_theme_key */
  selected_document_style_key?: string;
  save_section_key?: string;
};

export type IncomeDocumentBrandingSettingsEntrypoint = {
  visible: boolean;
  button_label: string;
  modal_title: string;
  allowed_actions: string[];
  commands: {
    update_branding_profile: string;
    preview_branding_profile_draft: string;
    upload_document_logo: string;
    upload_document_signature: string;
  };
};

export type IncomeBrandingPreviewDraftCommandResponse = {
  ok: true;
  command: typeof INCOME_COMMAND_UPDATE_BRANDING_PROFILE_PREVIEW_DRAFT;
  document_branding_studio_preview: IncomeDocumentBrandingStudioPreviewDraftResult;
};
