/** Mirrors API `AnnualTabResponse` — render-only on the client. */

export type AnnualDocumentRowStatus = 'missing' | 'checked_only' | 'attached_only' | 'completed';
export type AnnualDocumentRowStyle = 'neutral' | 'warning' | 'success' | 'missing';

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
  description_key?: string;
  required: boolean;
  document_name_he: string;
  document_name_key?: string;
  received: boolean;
  row_note: string | null;
  status: AnnualDocumentRowStatus;
  status_label_he: string;
  status_label_key?: string;
  row_style: AnnualDocumentRowStyle;
  receipt_mark?: 'none' | 'cyan_check';
  receipt_hint_key?: string | null;
  show_missing_badge?: boolean;
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
  status_label_key?: string;
  note: string | null;
  file: AnnualDocumentFileDto;
  actions: { can_edit: boolean; can_remove: boolean; can_attach_file: boolean; can_open_file: boolean };
};

export type AnnualControlStatusCode =
  | 'ready'
  | 'missing_docs'
  | 'attention'
  | 'unassigned'
  | 'collect_docs'
  | 'approaching'
  | 'overdue'
  | 'filed_idle';
export type AnnualControlColor = 'green' | 'yellow' | 'red' | 'neutral';

export type AnnualControlStatusDto = {
  code: AnnualControlStatusCode;
  label_he: string;
  label_key?: string;
  color: AnnualControlColor;
};

export type AnnualDeadlineInfoDto = {
  due_date: string;
  days_left: number;
  is_overdue: boolean;
  label_he: string;
  label_key?: string;
};

export type AnnualTabModel = {
  tab_key: 'annual_report' | 'capital_declaration';
  tab_title_he: string;
  title_key?: string;
  read_model_version: number;
  permissions: { can_view: boolean; can_edit: boolean };
  status: AnnualControlStatusDto;
  missing_documents: string[];
  completion_percent: number;
  deadline_info: AnnualDeadlineInfoDto;
  risk_indicator: { label_he: string; label_key?: string };
  missing_documents_section_title_he: string;
  missing_documents_section_title_key?: string;
  status_card_title_he: string;
  status_card_title_key?: string;
  meta: {
    updated_last_label_he: string;
    updated_last_display_he: string;
    updated_by_label_he: string;
    updated_by_display_he: string;
  };
  visibility: {
    show_documents: boolean;
    show_submissions: boolean;
    show_notes: boolean;
    show_deadline?: boolean;
    show_document_readiness?: boolean;
    show_missing_as_active_problem?: boolean;
    show_filed_confirmation?: boolean;
    show_working_status?: boolean;
    show_legacy_capital_folders?: boolean;
  };
  capital_workspace?: {
    working_panel: {
      title_key: string;
      date_field_label_key: string;
      assigned_due_date: string | null;
      can_assign_due_date: boolean;
      operational_period_key: string;
    };
    history_panel: {
      title_key: string;
      empty_state_key: string;
      entries: Array<{
        folder_key: string;
        instance_id: string;
        sequence_no: number;
        folder_label_key: string;
        status: 'open' | 'completed';
        operational_target_date: string | null;
        submitted_on: string | null;
        filed: boolean;
        files: Array<{
          file_asset_id: string;
          file_name: string | null;
          source_kind: 'form_1301' | 'additional' | 'checklist';
          source_kind_label_key: string;
          can_open: boolean;
          uploaded_on?: string | null;
          type_label?: string | null;
          actions?: { can_open: boolean; can_preview: boolean };
        }>;
      }>;
    };
  };
  assigned_due_date?: string | null;
  actual_submitted_on?: string | null;
  filed_confirmation?: {
    label_key: string;
    submitted_on: string | null;
    archive_folder_key: string | null;
    open_archive_label_key: string;
  } | null;
  documents_table: {
    card_title_he: string;
    card_title_key?: string;
    empty_state_key?: string;
    column_headers_he: string[];
    column_header_keys?: Array<string | null>;
    empty_state_he: string;
    add_custom_label_he: string;
    add_custom_label_key?: string;
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
    card_title_key?: string;
    empty_state_key?: string;
    column_headers_he: string[];
    column_header_keys?: Array<string | null>;
    empty_state_he: string;
    add_row_label_he: string;
    add_row_label_key?: string;
    add_row_enabled: boolean;
    rows: AnnualSubmissionRowDto[];
  };
  notes_card: {
    card_title_he: string;
    card_title_key?: string;
    notes: string | null;
    placeholder_he: string;
    placeholder_key?: string;
    save_label_he: string;
    save_label_key?: string;
    edit_enabled: boolean;
  };
  workspace_actions?: Array<{
    action_key: 'upload_document' | 'copy_previous';
    label_he: string;
    enabled: boolean;
  }>;
  file_open_path_template: string;
  current_tax_year?: number;
  working_tax_year?: number;
  document_readiness?: AnnualControlStatusDto;
  filing_status?: {
    filed: boolean;
    code: 'filed' | 'not_filed';
    label_key: string;
    submitted_on: string | null;
  };
  filing_years?: Array<{
    tax_year: number;
    is_current: boolean;
    is_working: boolean;
    filed: boolean;
    submitted_on: string | null;
    filing_status: {
      filed: boolean;
      code: 'filed' | 'not_filed';
      label_key: string;
      submitted_on: string | null;
    };
    can_select_working: boolean;
  }>;
  older_tax_years?: Array<{
    tax_year: number;
    filed: boolean;
    submitted_on: string | null;
    is_working: boolean;
    can_select: boolean;
  }>;
  older_tax_year_select?: {
    visible: boolean;
    can_select: boolean;
    label_key: string;
    placeholder_key: string;
  };
  documents_year_heading_label_key?: string;
  year_views?: Array<{
    tax_year: number;
    is_current: boolean;
    is_working: boolean;
    can_select: boolean;
    filing_status: {
      filed: boolean;
      code: 'filed' | 'not_filed';
      label_key: string;
      submitted_on: string | null;
    };
    filing_tone: 'green' | 'yellow';
    document_readiness: AnnualControlStatusDto;
    status: AnnualControlStatusDto;
    missing_documents: string[];
    completion_percent: number;
    deadline_info: AnnualDeadlineInfoDto;
    visibility: {
      show_working_checklist: boolean;
      show_missing_as_active_problem: boolean;
      show_filed_confirmation: boolean;
      show_document_readiness: boolean;
      show_deadline: boolean;
      show_documents_year_heading?: boolean;
    };
    documents_year_heading?: {
      visible: boolean;
      label_key: string;
      tax_year: number;
    } | null;
    filed_confirmation: {
      label_key: string;
      submitted_on: string | null;
      archive_folder_key: string | null;
      open_archive_label_key: string;
    } | null;
    documents_table: AnnualTabModel['documents_table'];
    allowed_actions: {
      can_select: boolean;
      can_edit_checklist: boolean;
    };
  }>;
  year_folders?: Array<{
    folder_key: string;
    tax_year: number;
    label: string;
    submission_id: string;
    submitted_on: string;
    filed: true;
    files: Array<{
      file_asset_id: string;
      file_name: string | null;
      source_kind: 'form_1301' | 'additional' | 'checklist';
      source_kind_label_key: string;
      can_open: boolean;
      uploaded_on?: string | null;
      type_label?: string | null;
      actions?: { can_open: boolean; can_preview: boolean };
    }>;
  }>;
  client_document_list?: {
    title_key: string;
    generate_label_key: string;
    preview_label_key: string;
    send_label_key: string;
    include_label_key: string;
    empty_key: string;
    can_generate: boolean;
    can_send: boolean;
    items: Array<{
      row_id: string;
      internal_name: string;
      client_facing_name: string;
      client_facing_description: string | null;
      include_in_client_list: boolean;
      source_type: 'system' | 'custom';
    }>;
    preview: {
      file_asset_id: string | null;
      generated_at: string | null;
      can_open: boolean;
    };
    send_history: Array<{
      send_id: string;
      generated_at: string;
      file_asset_id: string;
      docflow_message_id: string | null;
      frozen: true;
    }>;
    docflow_threads: Array<{ thread_id: string; label: string }>;
  };
  capital_folders?: Array<{
    folder_key: string;
    instance_id: string;
    sequence_no: number;
    folder_label_key: string;
    status: 'open' | 'completed';
    operational_target_date: string | null;
    submitted_on: string | null;
    filed: boolean;
    files: Array<{
      file_asset_id: string;
      file_name: string | null;
      source_kind: 'form_1301' | 'additional' | 'checklist';
      source_kind_label_key: string;
      can_open: boolean;
      uploaded_on?: string | null;
      type_label?: string | null;
      actions?: { can_open: boolean; can_preview: boolean };
    }>;
  }>;
};
