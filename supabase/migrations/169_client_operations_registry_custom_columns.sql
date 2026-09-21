-- Client Operations registry: organization-owned custom columns (max 10) + per-client values.
-- Definitions are org-scoped; values are (org, client, column). API also enforces max 10.

create table if not exists public.client_operations_registry_custom_columns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null check (char_length(key) >= 1 and char_length(key) <= 64),
  label text not null check (char_length(label) >= 1 and char_length(label) <= 80),
  data_type text not null check (data_type in ('text', 'number', 'date', 'boolean')),
  position int not null default 0 check (position >= 0 and position < 1000),
  visible boolean not null default true,
  archived_at timestamptz null,
  created_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);

comment on table public.client_operations_registry_custom_columns is
  'Org-scoped Client Operations registry custom column definitions; max 10 active (non-archived) per org enforced by trigger + API.';

create index if not exists idx_co_registry_custom_cols_org_pos
  on public.client_operations_registry_custom_columns (organization_id, position)
  where archived_at is null;

create trigger client_operations_registry_custom_columns_updated_at
  before update on public.client_operations_registry_custom_columns
  for each row execute function public.set_updated_at();

create or replace function public.client_operations_registry_custom_columns_enforce_max_10()
returns trigger
language plpgsql
as $$
declare
  active_count int;
begin
  if NEW.archived_at is not null then
    return NEW;
  end if;
  select count(*)::int into active_count
  from public.client_operations_registry_custom_columns
  where organization_id = NEW.organization_id
    and archived_at is null
    and id is distinct from NEW.id;
  if TG_OP = 'INSERT' then
    if active_count >= 10 then
      raise exception 'CLIENT_OPERATIONS_CUSTOM_COLUMN_LIMIT'
        using errcode = 'P0001';
    end if;
  elsif TG_OP = 'UPDATE' then
    if OLD.archived_at is not null and NEW.archived_at is null and active_count >= 10 then
      raise exception 'CLIENT_OPERATIONS_CUSTOM_COLUMN_LIMIT'
        using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_co_registry_custom_cols_max_10 on public.client_operations_registry_custom_columns;
create trigger trg_co_registry_custom_cols_max_10
  before insert or update on public.client_operations_registry_custom_columns
  for each row execute function public.client_operations_registry_custom_columns_enforce_max_10();

alter table public.client_operations_registry_custom_columns enable row level security;

create policy "co_registry_custom_cols_select_org_member"
  on public.client_operations_registry_custom_columns for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_registry_custom_cols_insert_org_member"
  on public.client_operations_registry_custom_columns for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_registry_custom_cols_update_org_member"
  on public.client_operations_registry_custom_columns for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_registry_custom_cols_delete_org_member"
  on public.client_operations_registry_custom_columns for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create table if not exists public.client_operations_registry_custom_column_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  column_id uuid not null references public.client_operations_registry_custom_columns(id) on delete cascade,
  value_text text null,
  value_number numeric null,
  value_date date null,
  value_bool boolean null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id, column_id)
);

comment on table public.client_operations_registry_custom_column_values is
  'Per-client values for Client Operations registry custom columns; typed columns mutually exclusive by data_type (API).';

create index if not exists idx_co_registry_custom_vals_org_client
  on public.client_operations_registry_custom_column_values (organization_id, client_id);

create index if not exists idx_co_registry_custom_vals_org_column
  on public.client_operations_registry_custom_column_values (organization_id, column_id);

create trigger client_operations_registry_custom_column_values_updated_at
  before update on public.client_operations_registry_custom_column_values
  for each row execute function public.set_updated_at();

alter table public.client_operations_registry_custom_column_values enable row level security;

create policy "co_registry_custom_vals_select_org_member"
  on public.client_operations_registry_custom_column_values for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_registry_custom_vals_insert_org_member"
  on public.client_operations_registry_custom_column_values for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_registry_custom_vals_update_org_member"
  on public.client_operations_registry_custom_column_values for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_registry_custom_vals_delete_org_member"
  on public.client_operations_registry_custom_column_values for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
