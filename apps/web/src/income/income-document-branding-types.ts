export type IncomeDocumentStyleGradient = {
  from: string;
  to: string;
};

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

export type IncomeDocumentStyleTemplate = {
  key: IncomeDocumentStyleTemplateKey;
  label: string;
  description: string;
  default_layout_template_key: IncomeLayoutTemplateKey;
  mini_preview_markup: string;
};

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
  save_command: string;
};

export type IncomeDocumentBrandingProfileAggregate = {
  profile_id: string;
  title: string;
  document_branding_studio: IncomeDocumentBrandingStudio;
  logo: IncomeDocumentBrandingAssetSlot;
  signature: IncomeDocumentBrandingAssetSlot;
  allowed_actions: string[];
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

export type IncomeBrandingStudioDraft = {
  document_style_key: string;
  color_theme_key: string;
  layout_template_key: string;
  logo_size_key: string;
  show_logo: string;
  company_subtitle: string;
  show_signature: string;
  footer_text: string;
  bank_name: string;
  bank_branch: string;
  bank_account: string;
  iban: string;
  swift: string;
  email_subject_template: string;
  email_body_template: string;
  customer_notes: string;
  terms_and_conditions: string;
};
