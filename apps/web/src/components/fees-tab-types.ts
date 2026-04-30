/** Fees tab read model from workspace aggregate (server-owned shape). */

export type FeesModalFieldGroup = 'agreement' | 'discount' | 'renewal';

export type FeesModalFieldVisibleWhenClauseModel = {
  field_key: string;
  any_of: string[];
};

export type FeesAgreementFieldModel = {
  key: string;
  label_he: string;
  type: 'text' | 'textarea' | 'date' | 'radio' | 'select' | 'number';
  value: string | boolean | null;
  options?: Array<{ value: string; label_he: string }>;
  visible: boolean;
  editable: boolean;
  modal_group?: FeesModalFieldGroup;
  modal_visible_when?: FeesModalFieldVisibleWhenClauseModel[];
};

export type FeesAgreementSummaryModel = {
  card_title_he: string;
  no_agreement_summary_he: string | null;
  status_chip: { label_he: string; token: string } | null;
  lines: Array<{ label_he: string; value_he: string }>;
};

/** יציב — תואם לשרת (client-fees-tab) */
export type FeesEditModalSectionKey = 'fees_agreement' | 'fees_discount' | 'fees_renewal';

export type FeesEditModalSectionModel = {
  section_key: FeesEditModalSectionKey;
  section_title_he: string;
  fields: FeesAgreementFieldModel[];
};

export type FeesModalLinesEditorModel = {
  section_title_he: string;
  section_subtitle_he: string;
  max_lines: number;
  add_button: { label_he: string; enabled: boolean; action_key: string } | null;
  rows: Array<{ persist_line: Record<string, unknown> }>;
};

export type FeesEditModalModel = {
  modal_title_he: string;
  save_hint_he: string;
  sections: FeesEditModalSectionModel[];
  included_lines_editor: FeesModalLinesEditorModel;
  custom_lines_editor: FeesModalLinesEditorModel;
};

export type FeesLineEditorLabelsModel = {
  modal_title_he: string;
  catalog_service_label_he: string;
  custom_name_label_he: string;
  charging_type_label_he: string;
  price_label_he: string;
  vat_mode_label_he?: string;
  payslip_count_label_he: string;
  unit_price_label_he: string;
  quantity_label_he: string;
  currency_label_he: string;
  line_total_label_he: string;
  active_label_he: string;
  active_option_yes_he: string;
  active_option_no_he: string;
};

export type FeesLineExchangeRateModalModel = {
  title_template_he: string;
  input_label_he: string;
  prompt_link_he: string;
  confirm_he: string;
  cancel_he: string;
};

export type FeesServiceRowModel = {
  line_id: string;
  persist_line: Record<string, unknown>;
  cells_he: string[];
  /** סה״כ לפני מע״מ — מחושב בשרת, תצוגה מוכנה */
  line_total_display_he: string;
  exchange_rate_required: boolean;
  edit_action: { label_he: string; enabled: boolean } | null;
  deactivate_action: { label_he: string; enabled: boolean } | null;
};

export type FeesTableSectionModel = {
  section_title_he: string;
  section_subtitle_he: string;
  column_headers_he: string[];
  add_button: { label_he: string; enabled: boolean; action_key: string } | null;
  rows: FeesServiceRowModel[];
  empty_state_he: string;
};

export type FeesKeyValueCardModel = {
  card_title_he: string;
  lines: Array<{ label_he: string; value_he: string; emphasize?: boolean }>;
  primary_value_he: string | null;
};

/** סיכום כספי — כולל סכומים גולמיים מהאגרגט */
export type FeesFinancialSummaryCardModel = FeesKeyValueCardModel & {
  total_before_vat?: number;
  total_vat?: number;
  total_with_vat?: number;
};

export type FeesRenewalCardModel = {
  card_title_he: string;
  banner: { variant: 'neutral' | 'success' | 'warning' | 'danger'; text_he: string } | null;
  lines: Array<{ label_he: string; value_he: string }>;
};

export type FeesRecentEventModel = {
  occurred_at_he: string;
  actor_he: string;
  summary_he: string;
};

export type FeesRecentHistoryCardModel = {
  card_title_he: string;
  view_full_link: { label_he: string; anchor_element_id: string };
  events: FeesRecentEventModel[];
  empty_state_he: string;
};

export type FeesPriceHistoryRowModel = {
  service_he: string;
  old_price_he: string;
  new_price_he: string;
  valid_from_he: string;
  valid_to_he: string;
  reason_he: string;
  updated_by_he: string;
  changed_at_he: string;
};

export type FeesPriceHistoryBarModel = {
  x_label_he: string;
  direction: 'up' | 'down' | 'flat';
  bar_height_0_100: number;
  delta_primary_he: string;
  snapshot_before_he: string;
  snapshot_after_he: string;
  tooltip_lines_he: string[];
};

export type FeesPriceHistoryChartViewMode = 'last_15' | 'all';

export type FeesPriceHistoryChartModel = {
  subtitle_he: string;
  y_axis_hint_he: string;
  bars: FeesPriceHistoryBarModel[];
  empty_state_he: string;
  chart_view_mode: FeesPriceHistoryChartViewMode;
  view_caption_he: string;
  overflow_hint_he: string | null;
  toggle_last_15_label_he: string;
  toggle_all_label_he: string;
};

export type FeesPriceHistoryTableModel = {
  card_title_he: string;
  column_headers_he: string[];
  rows: FeesPriceHistoryRowModel[];
  empty_state_he: string;
  chart: FeesPriceHistoryChartModel;
  section_anchor_id: string;
};

export type FeesTabModel = {
  tab_key: 'fees';
  tab_title_he: string;
  read_model_version: number;
  agreement_id: string;
  /** ערך enum מהשרת — תאריך חיוב בחודש */
  billing_day_range: string | null;
  permissions: { can_view: boolean; can_edit: boolean };
  meta: {
    updated_last_label_he: string;
    updated_last_display_he: string;
    updated_by_label_he: string;
    updated_by_display_he: string;
  };
  visibility: {
    show_agreement_details: boolean;
    show_service_sections: boolean;
    show_discount_block: boolean;
    show_financial_summary: boolean;
    show_renew_section: boolean;
    show_price_history: boolean;
    show_recent_history: boolean;
  };
  agreement_summary: FeesAgreementSummaryModel;
  edit_modal: FeesEditModalModel;
  built_in_catalog: Array<{ code: string; label_he: string }>;
  charging_type_options: Array<{ value: string; label_he: string }>;
  vat_mode_options: Array<{ value: string; label_he: string }>;
  fee_line_currency_options: Array<{ value: string; label_he: string }>;
  fee_line_exchange_rate_modal: FeesLineExchangeRateModalModel;
  line_editor_labels: FeesLineEditorLabelsModel;
  included_services: FeesTableSectionModel;
  custom_services: FeesTableSectionModel;
  financial_summary: FeesFinancialSummaryCardModel;
  discount_card: FeesKeyValueCardModel;
  renewal: FeesRenewalCardModel;
  recent_history: FeesRecentHistoryCardModel;
  price_history: FeesPriceHistoryTableModel;
};
