export type ClientHistorySectionKey =
  | 'client_profile'
  | 'taxes'
  | 'accounting'
  | 'fees'
  | 'payroll'
  | 'annual'
  | 'documents'
  | 'history_system';

export type ClientHistoryEventSummaryParams = Record<string, string | number>;

export type ClientHistoryTabModel = {
  tab_key: 'history';
  read_model_version: number;
  permissions: { can_view: boolean; can_export: boolean };
  ui: {
    title_he: string;
    title_key?: string;
    empty_state_he: string;
    empty_state_key?: string;
    retention_notice_he: string;
    retention_notice_key?: string;
    retention_archival_todo_he: string;
    retention_archival_todo_key?: string;
  };
  sections: Array<{
    section_key: ClientHistorySectionKey;
    title_he: string;
    title_key?: string;
    latest_events: Array<{
      event_id: string;
      occurred_at: string;
      occurred_display_he: string;
      actor_display_name: string | null;
      summary_he: string;
      summary_key?: string;
      summary_params?: ClientHistoryEventSummaryParams;
      summary_param_keys?: Record<string, string>;
      action_type: string;
    }>;
    total_events_in_last_12_months: number;
    can_open: boolean;
  }>;
  open_section: null | {
    section_key: ClientHistorySectionKey;
    title_he: string;
    title_key?: string;
    range: { from_date: string | null; to_date: string | null };
    events: Array<{
      event_id: string;
      occurred_at: string;
      occurred_display_he: string;
      actor_display_name: string | null;
      summary_he: string;
      summary_key?: string;
      summary_params?: ClientHistoryEventSummaryParams;
      summary_param_keys?: Record<string, string>;
      action_type: string;
      metadata_preview: Record<string, unknown> | null;
    }>;
    total_count: number;
    can_export: boolean;
  };
};
