/** Mirrors API `AnnualTabResponse` — render-only on the client. */

export type AnnualDocumentRowStatus = 'missing' | 'checked_only' | 'attached_only' | 'completed';
export type AnnualDocumentRowStyle = 'neutral' | 'warning' | 'success';

export type AnnualDocumentFileDto = {
  state: 'none' | 'attached';
  file_asset_id: string | null;
  file_name: string | null;
};

export type AnnualDocumentRowDto = {
  row_id: string;
  source_type: 'system' | 'custom';
  system_key: string | null;
  code: string | null;
  label_he: string;
  description_he: string | null;
  required: boolean;
  document_name_he: string;
  received: boolean;
  row_note: string | null;
  status: AnnualDocumentRowStatus;
  status_label_he: string;
  row_style: AnnualDocumentRowStyle;
  file: AnnualDocumentFileDto;
  actions: {
    can_toggle_received: boolean;
    can_attach_file: boolean;
    can_remove_file: boolean;
    can_edit_row_note: boolean;
    can_rename_document: boolean;
    can_remove_row: boolean;
  };
};

export type AnnualSubmissionRowDto = {
  submission_id: string;
  tax_year: number;
  submitted_on: string;
  status: string;
  status_label_he: string;
  note: string | null;
  file: AnnualDocumentFileDto;
  actions: { can_edit: boolean; can_remove: boolean; can_attach_file: boolean; can_open_file: boolean };
};

export type AnnualControlStatusCode = 'ready' | 'missing_docs' | 'attention';
export type AnnualControlColor = 'green' | 'yellow' | 'red';

export type AnnualControlStatusDto = {
  code: AnnualControlStatusCode;
  label_he: string;
  color: AnnualControlColor;
};

export type AnnualDeadlineInfoDto = {
  due_date: string;
  days_left: number;
  is_overdue: boolean;
  label_he: string;
};

export type AnnualTabModel = {
  tab_key: 'annual_report' | 'capital_declaration';
  tab_title_he: string;
  read_model_version: number;
  permissions: { can_view: boolean; can_edit: boolean };
  status: AnnualControlStatusDto;
  missing_documents: string[];
  completion_percent: number;
  deadline_info: AnnualDeadlineInfoDto;
  risk_indicator: { label_he: string };
  missing_documents_section_title_he: string;
  status_card_title_he: string;
  meta: {
    updated_last_label_he: string;
    updated_last_display_he: string;
    updated_by_label_he: string;
    updated_by_display_he: string;
  };
  visibility: { show_documents: boolean; show_submissions: boolean; show_notes: boolean };
  documents_table: {
    card_title_he: string;
    column_headers_he: string[];
    empty_state_he: string;
    add_custom_label_he: string;
    add_custom_enabled: boolean;
    /** מסופק מהאגרגט בלבד; אם חסר (גרסה ישנה של API) — לא להציג פס סיכום */
    summary?: {
      total_label_he: string;
      total_count: number;
      received_label_he: string;
      received_count: number;
      missing_label_he: string;
      missing_count: number;
      updated_label_he: string;
      updated_display_he: string;
    };
    rows: AnnualDocumentRowDto[];
  };
  submissions_table: {
    card_title_he: string;
    column_headers_he: string[];
    empty_state_he: string;
    add_row_label_he: string;
    add_row_enabled: boolean;
    rows: AnnualSubmissionRowDto[];
  };
  notes_card: {
    card_title_he: string;
    notes: string | null;
    placeholder_he: string;
    save_label_he: string;
    edit_enabled: boolean;
  };
  workspace_actions?: Array<{
    action_key: 'upload_document' | 'copy_previous';
    label_he: string;
    enabled: boolean;
  }>;
  file_open_path_template: string;
};
