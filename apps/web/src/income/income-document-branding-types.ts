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
