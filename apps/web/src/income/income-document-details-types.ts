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

export type IncomeDocumentDetailsStep = {
  draft_id: string;
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
