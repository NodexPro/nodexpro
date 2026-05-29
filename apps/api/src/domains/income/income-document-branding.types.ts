export const INCOME_COMMAND_UPDATE_BRANDING_PROFILE = 'update_income_document_branding_profile' as const;
export const INCOME_COMMAND_UPLOAD_DOCUMENT_LOGO = 'upload_income_document_logo' as const;
export const INCOME_COMMAND_UPLOAD_DOCUMENT_SIGNATURE = 'upload_income_document_signature' as const;

export type IncomeBrandingClientBlockPosition = 'left' | 'right';

export type IncomeBrandingQuantityPosition = 'before_description' | 'after_description';

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

export type IncomeBrandingProfileRow = {
  id: string;
  organization_id: string;
  issuer_business_id: string;
  represented_client_id: string | null;
  logo_file_asset_id: string | null;
  signature_file_asset_id: string | null;
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
  display_options: unknown;
  payment_methods: unknown;
  document_attachments: unknown;
  default_payment_terms: unknown;
};

export type IncomeBrandingResolvedProfile = {
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
  input_type: 'text' | 'textarea' | 'color' | 'boolean' | 'select';
  value: string | boolean;
  options?: { value: string; label: string }[];
  visible: boolean;
  editable: boolean;
  disabled_reason: string | null;
  hint: string | null;
};

export type IncomeDocumentBrandingSection = {
  key: string;
  title: string;
  fields: IncomeDocumentBrandingField[];
  save_command: string;
  allowed_actions: string[];
};

export type IncomeDocumentBrandingAssetSlot = {
  label: string;
  file_asset_id: string | null;
  preview_data_url: string | null;
  upload_command: string;
  allowed_actions: string[];
  hint: string | null;
};

export type IncomeDocumentBrandingProfileAggregate = {
  profile_id: string;
  title: string;
  sections: IncomeDocumentBrandingSection[];
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
