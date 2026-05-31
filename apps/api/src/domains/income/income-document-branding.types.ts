export const INCOME_COMMAND_UPDATE_BRANDING_PROFILE = 'update_income_document_branding_profile' as const;
export const INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO = 'upload_income_document_logo' as const;
export const INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE = 'upload_income_document_signature' as const;

export type IncomeBrandingClientBlockPosition = 'left' | 'right';

export type IncomeBrandingQuantityPosition = 'before_description' | 'after_description';

export type IncomeDocumentStyleTemplateKey = 'classic' | 'modern' | 'elegant' | 'minimal';

export type IncomeLayoutTemplateKey =
  | 'logo_left_client_right'
  | 'logo_top_client_below'
  | 'israeli_classic'
  | 'logo_right_client_left';

export type IncomeLogoSizeKey = 'small' | 'medium' | 'large';

export type IncomeBrandingStudioSectionKey =
  | 'document_style'
  | 'logo_branding'
  | 'business'
  | 'payment'
  | 'email';

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
  email_subject_template: string | null;
  email_body_template: string | null;
  customer_notes: string | null;
  terms_and_conditions: string | null;
  display_options: unknown;
  payment_methods: unknown;
  document_attachments: unknown;
  default_payment_terms: unknown;
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
  email_subject_template: string | null;
  email_body_template: string | null;
  customer_notes: string | null;
  terms_and_conditions: string | null;
};

export type IncomeDocumentBrandingStudio = {
  navigation_sections: Array<{ key: IncomeBrandingStudioSectionKey; label: string }>;
  document_style_templates: IncomeDocumentStyleTemplate[];
  color_theme_presets: IncomeColorThemePreset[];
  layout_templates: IncomeLayoutTemplate[];
  logo_size_options: IncomeLogoSizeOption[];
  selected_document_style_key: IncomeDocumentStyleTemplateKey;
  selected_color_theme_key: string;
  selected_layout_template_key: IncomeLayoutTemplateKey | null;
  selected_logo_size_key: IncomeLogoSizeKey;
  advanced_layout_visible: boolean;
  studio_live_preview: IncomeDocumentBrandingStudioLivePreview;
  fields: IncomeDocumentBrandingStudioFields;
  save_section_key: 'modal';
  save_command: typeof INCOME_COMMAND_UPDATE_BRANDING_PROFILE;
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
    upload_document_logo: string;
    upload_document_signature: string;
  };
};
