export type IncomeDocumentStyleGradient = {
  from: string;
  to: string;
};

export type IncomeDocumentStyleTemplateKey = 'classic' | 'modern' | 'elegant';

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

export type IncomeBrandingPaymentMethod = {
  key: string;
  label: string;
  enabled: boolean;
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

export type IncomeColorThemePresetStudio = IncomeColorThemePreset & {
  studio_label: string;
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
  save_command: string;
  preview_draft_command: string;
};

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
    preview_branding_profile_draft: string;
    upload_document_logo: string;
    upload_document_signature: string;
  };
};

export type IncomeBrandingPreviewDraftCommandResponse = {
  ok: true;
  command: 'update_income_document_branding_profile_preview_draft';
  document_branding_studio_preview: IncomeDocumentBrandingStudioPreviewDraftResult;
};

export type IncomeBrandingStudioDraft = {
  document_style_key: string;
  color_theme_key: string;
  logo_size_key: string;
  selected_document_type_group_key: IncomeDocumentTypeStyleGroupKey;
  document_type_style_overrides: Partial<
    Record<IncomeDocumentTypeStyleGroupKey, IncomeDocumentTypeStyleOverride>
  >;
  show_logo: string;
  show_signature: string;
  show_footer: string;
  show_notes: string;
  show_payment_terms: string;
  show_bank_details: string;
  show_due_date: string;
  show_vat_row: string;
  payment_method_bank_transfer: string;
  payment_method_credit_card: string;
  payment_method_cash: string;
  payment_method_check: string;
  payment_method_paypal: string;
  payment_method_bit: string;
  company_subtitle: string;
  footer_text: string;
  bank_name: string;
  bank_branch: string;
  bank_account: string;
  iban: string;
  swift: string;
  payment_instructions: string;
  email_subject_friendly: string;
  email_body_friendly: string;
  customer_notes: string;
  terms_and_conditions: string;
};
