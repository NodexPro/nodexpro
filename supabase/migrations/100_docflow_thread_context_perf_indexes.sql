-- DocFlow perf: client-thread-context aggregate hot paths.
-- Goal: keep GET /docflow/aggregates/client-thread-context < 500ms.

-- Latest non-archived thread lookup by client (ORDER BY updated_at DESC LIMIT 1/50)
create index if not exists idx_docflow_threads_by_client_updated
  on public.client_message_threads(org_id, client_id, updated_at desc)
  where thread_status <> 'archived';

-- Latest messages for a specific thread (ORDER BY created_at DESC LIMIT 20)
create index if not exists idx_docflow_messages_by_thread_created
  on public.client_messages(org_id, client_id, thread_id, created_at desc);

-- Attachments by message ids within a thread (WHERE ... IN (message_id...) ORDER BY created_at ASC)
create index if not exists idx_docflow_attachments_by_message
  on public.client_message_attachments(org_id, client_id, thread_id, message_id, created_at);

