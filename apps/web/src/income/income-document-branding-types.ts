export type IncomeDocumentBrandingColorPreset = {
  key: string;
  label: string;
  primary_color: string;
  table_header_color: string;
  totals_color: string;
  secondary_color: string;
  text_color: string;
  print_safe: boolean;
};

export type IncomeDocumentBrandingField = {
  key: string;
  label: string;
  input_type: 'text' | 'textarea' | 'boolean' | 'select' | 'color_preset';
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
};

export type IncomeDocumentBrandingProfileAggregate = {
  profile_id: string;
  title: string;
  tabs: IncomeDocumentBrandingTab[];
  color_presets: IncomeDocumentBrandingColorPreset[];
  selected_color_preset_key: string;
  save_section_key: string;
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
