-- Client Operations ToDo — one-time / external client.
-- Additive + backward compatible. DO NOT RUN until release approval.
-- Release order: MIGRATION -> API -> WEB (the API selects the new columns).
--
-- A ToDo may reference EITHER a canonical Core client (client_id, unchanged semantics) OR a one-time client
-- that lives only on the ToDo itself (external_client_name + optional external_client_tax_id).
-- A one-time client is NOT a Core client: no clients row, no client_operational_profile, no ACL grant,
-- no fake client_id. client_id is never overloaded with text.
--
-- Existing rows: client_id IS NOT NULL and both new columns are NULL -> they satisfy the identity check
-- below, so no backfill is needed.

alter table public.client_operations_todos
  alter column client_id drop not null;

alter table public.client_operations_todos
  add column if not exists external_client_name text null,
  add column if not exists external_client_tax_id text null;

comment on column public.client_operations_todos.client_id is
  'Canonical Core client (clients.id). NULL only for a one-time/external client (external_client_name set).';
comment on column public.client_operations_todos.external_client_name is
  'One-time client display name owned by this ToDo only. Never a Core client. NULL for canonical-client ToDos.';
comment on column public.client_operations_todos.external_client_tax_id is
  'Optional manually entered ת.ז./ח.פ. for a one-time client. No legal validation; never written to Core.';

alter table public.client_operations_todos
  drop constraint if exists client_operations_todos_external_client_name_valid;
alter table public.client_operations_todos
  add constraint client_operations_todos_external_client_name_valid
  check (
    external_client_name is null
    or (
      external_client_name = btrim(external_client_name)
      and length(btrim(external_client_name)) > 0
      and char_length(external_client_name) <= 200
    )
  );

alter table public.client_operations_todos
  drop constraint if exists client_operations_todos_external_client_tax_id_valid;
alter table public.client_operations_todos
  add constraint client_operations_todos_external_client_tax_id_valid
  check (
    external_client_tax_id is null
    or (
      external_client_tax_id = btrim(external_client_tax_id)
      and length(btrim(external_client_tax_id)) > 0
      and char_length(external_client_tax_id) <= 50
    )
  );

-- Exactly ONE client identity mode per ToDo.
alter table public.client_operations_todos
  drop constraint if exists client_operations_todos_client_identity_mode;
alter table public.client_operations_todos
  add constraint client_operations_todos_client_identity_mode
  check (
    (
      client_id is not null
      and external_client_name is null
      and external_client_tax_id is null
    )
    or (
      client_id is null
      and external_client_name is not null
    )
  );

-- The composite FK client_operations_todos_client_org_fk (client_id, organization_id) -> clients(id, organization_id)
-- is intentionally kept as-is. It uses MATCH SIMPLE, so it is not evaluated when client_id IS NULL, and it still
-- enforces tenant/client integrity (and ON DELETE CASCADE) for every canonical-client ToDo.
-- RLS policies, grants and indexes are unchanged; the existing (organization_id, assigned_to_user_id, ...) indexes
-- already serve the workspace-owner reads for one-time ToDos.
