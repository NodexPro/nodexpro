-- Idempotent human sends: office + portal text (and portal start-thread first message).
-- Scoped by org_id + client_id + idempotency_scope + idempotency_key.

alter table public.client_messages
  add column if not exists idempotency_scope text,
  add column if not exists idempotency_key text;

comment on column public.client_messages.idempotency_scope is 'Human send command name for idempotency (e.g. send_office_message).';
comment on column public.client_messages.idempotency_key is 'Client-supplied key; unique per org + client + scope.';

create unique index if not exists uq_client_messages_human_idempotency
  on public.client_messages (org_id, client_id, idempotency_scope, idempotency_key)
  where idempotency_key is not null
    and btrim(idempotency_key) <> ''
    and idempotency_scope is not null
    and btrim(idempotency_scope) <> '';
