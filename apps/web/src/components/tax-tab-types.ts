/**
 * Sync with apps/api/src/domains/client-operations/client-tax-tab-read-model.service.ts
 * — tax workspace aggregate for the מיסים tab.
 */

/** Mirrors API public shape — values are backend codes (Hebrew labels in UI only). */
export type ClientTaxSettingsPublic = {
  vat_type: string | null;
  vat_frequency: string | null;
  vat_due_type: string | null;
  income_tax_advance_enabled: boolean;
  income_tax_advance_percent: number | null;
  income_tax_advance_frequency: string | null;
  income_tax_advance_ui_selection: 'choose' | 'yes' | 'no';
  income_tax_deductions_enabled: boolean;
  income_tax_deductions_file_number: string | null;
  income_tax_deductions_frequency: string | null;
  income_tax_deductions_ui_selection: 'choose' | 'yes' | 'no';
  national_insurance_type: string | null;
  national_insurance_monthly_amount: number | null;
  national_insurance_deductions_file_number: string | null;
  vat_payment_method: string | null;
  vat_payment_masked: {
    last4: string | null;
    expiry: string | null;
    card_number_masked?: string | null;
    brand?: string | null;
  };
  income_tax_payment_method: string | null;
  income_tax_payment_masked: {
    last4: string | null;
    expiry: string | null;
    card_number_masked?: string | null;
    brand?: string | null;
  };
  vat_card_holder_name: string | null;
  income_tax_card_holder_name: string | null;
  client_tax_id: string | null;
  client_display_name: string | null;
  payment_secure_sessions: {
    vat: { active: boolean; expires_at: string | null };
    income_tax: { active: boolean; expires_at: string | null };
  };
  vat_other_payment_text: string | null;
  income_tax_other_payment_text: string | null;
  notes: string | null;
  vat_divuach_next_due_at: string | null;
  vat_divuach_next_due_display_he: string | null;
  vat_due_registry_display_he: string | null;
};

export type OsekPaturVatDueUi = {
  label_he: string;
  date_display_he: string;
  tooltip_title_he: string;
  tooltip_body_he: string;
};

export type ClientTaxUiHints = {
  income_tax_advance_modal: boolean;
  income_tax_deductions_modal: boolean;
  national_insurance_modal: boolean;
  vat_credit_modal: boolean;
  income_tax_credit_modal: boolean;
  vat_other_modal: boolean;
  income_tax_other_modal: boolean;
  vat_frequency_disabled?: boolean;
  osek_patur_vat_due?: OsekPaturVatDueUi | null;
  national_insurance_deductions_disabled?: boolean;
  national_insurance_deductions_label_he?: string;
  national_insurance_deductions_inactive_display_he?: string;
};

export type ClientTaxSettingsBundle = {
  settings: ClientTaxSettingsPublic;
  ui: ClientTaxUiHints;
};

/** Must match server `TaxTabCommandType`. */
export type TaxTabCommandType =
  | 'update_tax_vat_registration'
  | 'update_tax_income_advances'
  | 'update_tax_income_deductions'
  | 'update_tax_national_insurance'
  | 'update_tax_vat_payment'
  | 'update_tax_income_tax_payment'
  | 'update_tax_notes';

export type TaxTabDisplayTone = 'default' | 'muted' | 'warning' | 'not_relevant';

export type TaxTabDisplayRow = {
  row_key: string;
  label_he: string;
  value_he: string;
  tone?: TaxTabDisplayTone;
};

/** Edit button + command routing (affordance only). */
export type TaxTabSectionEditAffordance = {
  command: TaxTabCommandType;
  enabled: boolean;
  button_label_he: string;
};

export type TaxTabSectionKey =
  | 'vat_registration'
  | 'income_tax_advances'
  | 'income_tax_deductions'
  | 'national_insurance'
  | 'vat_payment'
  | 'income_tax_payment'
  | 'notes';

export type TaxTabPaymentInteractionKind = 'plain_clipboard' | 'secure_reveal_clipboard';

export type TaxTabPaymentSecureRef = {
  payment_channel: 'vat' | 'income_tax';
  secret_kind: 'card_number' | 'expiry';
};

export type TaxTabPaymentRowSecureState = {
  in_flight: boolean;
  disabled: boolean;
  disabled_reason_he: string | null;
};

export type TaxTabPaymentPanelCopyControl = {
  show: boolean;
  aria_label_he: string;
  disabled?: boolean;
  disabled_reason_he?: string | null;
};

export type TaxTabPaymentPanelRow = {
  row_key: string;
  label_he: string;
  value_display_he: string;
  card_brand: string | null;
  value_cell_layout: 'default' | 'card_with_brand';
  interaction: TaxTabPaymentInteractionKind;
  clipboard_plain_text: string | null;
  secure: TaxTabPaymentSecureRef | null;
  copy_control: TaxTabPaymentPanelCopyControl;
  secure_state: TaxTabPaymentRowSecureState | null;
};

export type TaxTabPaymentPanelModel = {
  visible: boolean;
  payment_channel: 'vat' | 'income_tax';
  secure_session: { active: boolean; expires_at: string | null };
  cvv_footer_he: string;
  card_expired_warning: boolean;
  rows: TaxTabPaymentPanelRow[];
};

export type TaxTabEditFieldKind =
  | 'enum'
  | 'tri_state'
  | 'text'
  | 'textarea'
  | 'number'
  | 'payment_method_select';

export type TaxTabEditFieldOption = { value: string; label_he: string };

export type TaxTabEditFieldDef = {
  field_key: string;
  label_he: string;
  kind: TaxTabEditFieldKind;
  disabled: boolean;
  readonly: boolean;
  hidden: boolean;
  hint_he: string | null;
  validation_hint_he: string | null;
  options?: TaxTabEditFieldOption[];
};

export type TaxTabSectionFormEditModel = {
  fields: TaxTabEditFieldDef[];
  values: Record<string, string | number | boolean | null>;
  extras?: Record<string, string | null>;
};

export type TaxTabSectionReadModel = {
  section_key: TaxTabSectionKey;
  title_he: string;
  visible: boolean;
  display_rows: TaxTabDisplayRow[];
  edit: TaxTabSectionEditAffordance;
  edit_model: TaxTabSectionFormEditModel;
  payment_panel?: TaxTabPaymentPanelModel | null;
};

export type TaxTabHeaderReadModel = {
  title_he: string;
  client_tax_id: string | null;
  client_display_name: string | null;
  summary_rows: TaxTabDisplayRow[];
};

export type TaxTabCommandBaseline = {
  settings: ClientTaxSettingsPublic;
};

export type TaxTabWorkspaceResponse = {
  read_model_version: number;
  ui: ClientTaxUiHints;
  baseline: TaxTabCommandBaseline;
  header: TaxTabHeaderReadModel;
  sections: TaxTabSectionReadModel[];
};
