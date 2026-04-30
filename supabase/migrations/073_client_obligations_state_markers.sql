alter table if exists public.client_obligations
  add column if not exists docflow_message_sent_at timestamptz null,
  add column if not exists last_reported_at timestamptz null;

create index if not exists idx_client_obligations_docflow_message_sent_at
  on public.client_obligations (organization_id, client_id, docflow_message_sent_at);
