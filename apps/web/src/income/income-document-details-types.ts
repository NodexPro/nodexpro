export type IncomeDocumentDetailsSettingField = {
  key: string;
  label: string;
  input_type: 'date' | 'select' | 'text';
  value: string | null;
  required: boolean;
  options?: { value: string; label: string }[];
  visible: boolean;
  disabled: boolean;
  disabled_reason: string | null;
};

export type IncomeDocumentDetailsLineRow = {
  id: string;
  line_id: string;
  row_number: number;
  can_drag: boolean;
  description: { value: string; editable: boolean; placeholder: string };
  quantity: { value: string; editable: boolean };
  unit_price: { value: string; editable: boolean };
  currency: {
    value: string;
    editable: boolean;
    options: { value: string; label: string }[];
  };
  allowed_currencies: { value: string; label: string }[];
  vat_rate_code: string;
  vat_rate_label: string;
  allowed_vat_rates: { value: string; label: string }[];
  price_includes_vat: boolean;
  price_mode_options: { value: boolean; label: string }[];
  exchange_rate_official: string | null;
  exchange_rate_effective: string | null;
  exchange_rate_override: { value: string; editable: boolean } | null;
  exchange_rate_date: string | null;
  exchange_rate_source_label: string | null;
  exchange_rate_editable: boolean;
  /** @deprecated use exchange_rate_official */
  exchange_rate_default?: string | null;
  line_total_display: string;
  line_total: { display: string };
  field_errors: { code: string; message: string }[];
  allowed_actions: string[];
};

export type IncomeDocumentDetailsDiscount = {
  enabled: boolean;
  editable: boolean;
  type: 'percent' | 'fixed_amount';
  value: string;
  currency: string;
  amount_display: string | null;
  percent_display: string | null;
  calculated_discount_amount_display: string | null;
  affects_vat: true;
  field_errors: Record<string, string>;
  allowed_actions: string[];
};

export type IncomeDocumentDetailsTotalsRow = {
  key: string;
  label: string;
  amount_display: string;
  tone: 'neutral' | 'good' | 'warning' | 'danger';
  emphasized: boolean;
};

export type IncomeDocumentDetailsTotalsBlock = {
  rows: IncomeDocumentDetailsTotalsRow[];
  grand_total_display: string;
  currency: string;
};

export type {
  IncomeDocumentBrandingProfileAggregate,
  IncomeDocumentBrandingTab,
  IncomeDocumentBrandingField,
  IncomeDocumentBrandingAssetSlot,
  IncomeDocumentBrandingColorPreset,
} from './income-document-branding-types';

export type IncomeDocumentDetailsStep = {
  draft_id: string;
  document_type_key?: string | null;
  document_discount: IncomeDocumentDetailsDiscount;
  totals_block: IncomeDocumentDetailsTotalsBlock;
  document_branding_profile?: import('./income-document-branding-types').IncomeDocumentBrandingProfileAggregate | null;
  document_preview?: {
    visible: boolean;
    preview_status: 'ready' | 'not_generated';
    generated_at: string | null;
    document_type_label: string;
    document_number_preview: string | null;
    issuer: {
      display_name: string;
      tax_id: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
    };
    recipient: {
      display_name: string;
      tax_id: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
    };
    dates: { document_date: string | null; due_date: string | null };
    currency: string;
    preview_html: string;
    validation_messages: Array<{
      severity: 'info' | 'warning' | 'danger';
      label: string;
      field: string | null;
      blocking: boolean;
    }>;
    allowed_actions: string[];
    toolbar_actions: Array<{
      action: string;
      label: string;
      enabled: boolean;
      reason: string | null;
    }>;
  } | null;
  draft_state_display?: {
    status: 'draft';
    label: string;
    tone: 'neutral' | 'good' | 'warning' | 'danger';
    last_saved_at: string | null;
    saved_by_label: string | null;
    allowed_actions: string[];
  };
  header: {
    title: string;
    subtitle: string | null;
    document_number_preview: string | null;
  };
  settings_schema: IncomeDocumentDetailsSettingField[];
  line_items: {
    columns: { key: string; label: string }[];
    document_fields?: {
      currency: { value: string; options: { value: string; label: string }[] };
      vat_mode: { value: string; options: { value: string; label: string }[] };
    };
    rows: IncomeDocumentDetailsLineRow[];
    allowed_actions: string[];
    add_row_label: string;
    empty_state: { visible: boolean; message: string };
    totals: {
      subtotal: { label: string; display: string };
      vat: { label: string; display: string } | null;
      grand_total: { label: string; display: string };
      currency: string;
      not_financial_truth: boolean;
    };
  };
  notes: { value: string; label: string; editable: boolean };
  delivery_contact: {
    email: string | null;
    label: string;
    editable: boolean;
    hint: string | null;
  };
  validation_warnings: { code: string; message: string }[];
};
