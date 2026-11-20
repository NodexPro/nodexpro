-- Versioned client-facing document list for annual report and capital declaration.
-- PDF snapshots are frozen on send so later checklist edits do not rewrite history.

alter table public.client_annual_document_rows
  add column if not exists include_in_client_list boolean not null default false;

alter table public.client_annual_document_rows
  add column if not exists client_facing_name_he text null;

alter table public.client_annual_document_rows
  add column if not exists client_facing_description_he text null;

update public.client_annual_document_rows
set include_in_client_list = true
where source_type = 'custom';

update public.client_annual_document_rows
set include_in_client_list = true
where tab_scope = 'capital_declaration'
  and coalesce(required, false) = true;

create table if not exists public.client_annual_document_list_sends (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  tab_scope text not null,
  tax_year int null,
  declaration_date date null,
  file_asset_id uuid not null references public.file_assets(id),
  snapshot_json jsonb not null,
  docflow_message_id uuid null,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id)
);

create index if not exists idx_client_annual_document_list_sends_org_client
  on public.client_annual_document_list_sends (organization_id, client_id, tab_scope, created_at desc);

alter table public.client_annual_document_list_sends enable row level security;

create policy "client_annual_document_list_sends_select_org_member"
  on public.client_annual_document_list_sends for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_annual_document_list_sends_insert_org_member"
  on public.client_annual_document_list_sends for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_annual_document_list_sends_update_org_member"
  on public.client_annual_document_list_sends for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

-- Snapshot and file stay frozen. Only delivery metadata (docflow_message_id) may change.
create or replace function public.client_annual_document_list_sends_freeze()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.client_id is distinct from old.client_id
     or new.tab_scope is distinct from old.tab_scope
     or new.tax_year is distinct from old.tax_year
     or new.declaration_date is distinct from old.declaration_date
     or new.file_asset_id is distinct from old.file_asset_id
     or new.snapshot_json is distinct from old.snapshot_json
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'client document list snapshot is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists client_annual_document_list_sends_freeze on public.client_annual_document_list_sends;
create trigger client_annual_document_list_sends_freeze
  before update on public.client_annual_document_list_sends
  for each row execute function public.client_annual_document_list_sends_freeze();
