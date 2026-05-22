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
  line_id: string;
  row_number: number;
  description: { value: string; editable: boolean };
  quantity: { value: string; editable: boolean };
  unit_price: { value: string; display: string; editable: boolean };
  vat: { label: string };
  line_total: { display: string };
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
