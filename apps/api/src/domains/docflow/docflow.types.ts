export type DocflowCommandType =
  | 'invite_client_to_docflow'
  | 'invite_selected_clients_to_docflow'
  | 'invite_all_clients_to_docflow'
  | 'issue_docflow_invite_delivery'
  | 'resend_invite'
  | 'revoke_invite'
  | 'accept_client_portal_invitation'
  | 'revoke_client_portal_access'
  | 'archive_client_thread'
  | 'reopen_client_thread'
  | 'create_client_thread'
  | 'change_thread_status'
  | 'assign_thread_to_user'
  | 'set_thread_deadline'
  | 'create_system_message'
  | 'send_office_message'
  | 'send_client_message'
  | 'attach_file_to_client_message'
  | 'remove_message_attachment'
  | 'mark_thread_read_by_office'
  | 'mark_thread_read_by_client'
  | 'run_communication_rule'
  | 'approve_draft_message'
  | 'edit_draft_message'
  | 'cancel_draft_message'
  | 'send_approved_message';

export type DocflowActorType = 'office' | 'client' | 'system';

export type DocflowCommandPayload = Record<string, unknown>;

export type AllowedAction = {
  command: string;
  enabled: boolean;
  reason: string | null;
};

export type DocflowRefreshedAggregateKey =
  | 'client_docflow_tab_aggregate'
  | 'docflow_invites_management_aggregate'
  | 'client_portal_inbox_aggregate'
  | 'communication_rule_run_review_aggregate'
  | 'docflow_floating_widget_aggregate';

export type DocflowCommandResponse = {
  ok: true;
  command: DocflowCommandType;
  refreshed: {
    aggregate_key: DocflowRefreshedAggregateKey;
    aggregate: Record<string, unknown>;
  };
};

/**
 * Owner Panel legal value version payload for DocFlow communication (JSON in value_payload_json).
 * Platform owner edits message_template via Country Pack legal value version; DocFlow never hardcodes client text.
 */
export type DocflowCommunicationLegalValuePayload = {
  type: 'docflow_communication';
  message_template: string;
  review_required?: boolean;
  target_filter?: string | Record<string, unknown>;
  condition_config?: Record<string, unknown>;
  schedule_config?: Record<string, unknown>;
  message_type?: 'system' | 'reminder';
};

