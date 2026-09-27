-- Client Operations: period-scoped manual cell status markers (paint palette).
-- Schema only. Does NOT fabricate payment / statutory / workflow facts.
-- Does NOT reapply 170–177.

create table if not exists public.client_operations_cell_manual_statuses (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  operational_period_key text not null
    check (operational_period_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  column_key text not null
    check (char_length(btrim(column_key)) >= 1 and char_length(column_key) <= 80),
  status text not null
    check (status in ('ready', 'sent_for_approval', 'completed')),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id) on delete set null,
  primary key (organization_id, client_id, operational_period_key, column_key)
);

comment on table public.client_operations_cell_manual_statuses is
  'Manual operational cell markers for Client Operations Excel paint mode; not Accounting Base or statutory truth.';

create index if not exists idx_co_cell_manual_status_org_period
  on public.client_operations_cell_manual_statuses (organization_id, operational_period_key);

create index if not exists idx_co_cell_manual_status_org_client_period
  on public.client_operations_cell_manual_statuses (organization_id, client_id, operational_period_key);

alter table public.client_operations_cell_manual_statuses enable row level security;

create policy client_operations_cell_manual_statuses_select
  on public.client_operations_cell_manual_statuses for select to authenticated
  using (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

create policy client_operations_cell_manual_statuses_insert
  on public.client_operations_cell_manual_statuses for insert to authenticated
  with check (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

create policy client_operations_cell_manual_statuses_update
  on public.client_operations_cell_manual_statuses for update to authenticated
  using (organization_id = (auth.jwt() ->> 'organization_id')::uuid)
  with check (organization_id = (auth.jwt() ->> 'organization_id')::uuid);

create policy client_operations_cell_manual_statuses_delete
  on public.client_operations_cell_manual_statuses for delete to authenticated
  using (organization_id = (auth.jwt() ->> 'organization_id')::uuid);
