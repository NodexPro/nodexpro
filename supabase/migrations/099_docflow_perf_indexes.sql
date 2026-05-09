-- DocFlow perf: accelerate client-context unread batch queries.
-- Goal: keep aggregate load < 1s for office messenger.

create index if not exists idx_docflow_events_office_read_marker
  on public.client_message_events(org_id, client_id, thread_id, event_type, created_at desc);

create index if not exists idx_docflow_messages_unread_scan
  on public.client_messages(org_id, client_id, thread_id, created_at)
  where message_status = 'published' and created_by_type <> 'office';

