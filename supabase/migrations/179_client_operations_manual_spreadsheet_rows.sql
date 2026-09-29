-- Client Operations: period-scoped MANUAL spreadsheet row cell values (5 slots).
-- NOT Core clients. NO client_id. NOT Accounting Base.
-- Does NOT reapply migrations 170–178.
-- Forward-only / run once. create if not exists / create or replace function only — no DROP.

-- ---------------------------------------------------------------------------
-- Sparse cell values (org + period + slot + column_key)
-- ---------------------------------------------------------------------------
create table if not exists public.client_operations_manual_row_cell_values (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operational_period_key text not null
    check (operational_period_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  manual_row_slot smallint not null
    check (manual_row_slot >= 1 and manual_row_slot <= 5),
  column_key text not null
    check (char_length(btrim(column_key)) >= 1 and char_length(column_key) <= 80),
  value_text text not null default ''
    check (char_length(value_text) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id) on delete set null,
  primary key (organization_id, operational_period_key, manual_row_slot, column_key)
);

comment on table public.client_operations_manual_row_cell_values is
  'Period-scoped free-text cells for five Client Operations manual spreadsheet slots; not Core clients or Accounting Base.';

create index if not exists idx_co_manual_row_cell_org_period
  on public.client_operations_manual_row_cell_values (organization_id, operational_period_key);

create index if not exists idx_co_manual_row_cell_org_period_slot
  on public.client_operations_manual_row_cell_values (organization_id, operational_period_key, manual_row_slot);

alter table public.client_operations_manual_row_cell_values enable row level security;

create policy "co_manual_row_cell_values_select_org_member"
  on public.client_operations_manual_row_cell_values for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_manual_row_cell_values_insert_org_member"
  on public.client_operations_manual_row_cell_values for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_manual_row_cell_values_update_org_member"
  on public.client_operations_manual_row_cell_values for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_manual_row_cell_values_delete_org_member"
  on public.client_operations_manual_row_cell_values for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

-- ---------------------------------------------------------------------------
-- First-touch setup marker (carry-forward runs once per org+period)
-- ---------------------------------------------------------------------------
create table if not exists public.client_operations_manual_rows_period_setup (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operational_period_key text not null
    check (operational_period_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  initialized_at timestamptz not null default now(),
  initialized_by uuid null references public.users(id) on delete set null,
  primary key (organization_id, operational_period_key)
);

comment on table public.client_operations_manual_rows_period_setup is
  'Marks first-touch initialization of manual spreadsheet rows for an operational period (carry-forward once).';

alter table public.client_operations_manual_rows_period_setup enable row level security;

create policy "co_manual_rows_period_setup_select_org_member"
  on public.client_operations_manual_rows_period_setup for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_manual_rows_period_setup_insert_org_member"
  on public.client_operations_manual_rows_period_setup for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_manual_rows_period_setup_update_org_member"
  on public.client_operations_manual_rows_period_setup for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_manual_rows_period_setup_delete_org_member"
  on public.client_operations_manual_rows_period_setup for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

-- ---------------------------------------------------------------------------
-- Atomic first-touch: claim setup marker + copy previous calendar period once
-- ---------------------------------------------------------------------------
create or replace function public.initialize_client_operations_manual_rows_for_period(
  p_organization_id uuid,
  p_operational_period_key text,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int := 0;
  v_year int;
  v_month int;
  v_prev text;
begin
  if p_organization_id is null then
    raise exception 'organization_id required' using errcode = '22023';
  end if;
  if p_operational_period_key is null
     or p_operational_period_key !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'operational_period_key must be YYYY-MM' using errcode = '22023';
  end if;

  insert into public.client_operations_manual_rows_period_setup (
    organization_id,
    operational_period_key,
    initialized_at,
    initialized_by
  )
  values (
    p_organization_id,
    p_operational_period_key,
    now(),
    p_actor_user_id
  )
  on conflict (organization_id, operational_period_key) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return false;
  end if;

  v_year := substring(p_operational_period_key from 1 for 4)::int;
  v_month := substring(p_operational_period_key from 6 for 2)::int;
  v_month := v_month - 1;
  if v_month < 1 then
    v_month := 12;
    v_year := v_year - 1;
  end if;
  if v_year < 1 then
    return true;
  end if;
  v_prev := lpad(v_year::text, 4, '0') || '-' || lpad(v_month::text, 2, '0');

  insert into public.client_operations_manual_row_cell_values (
    organization_id,
    operational_period_key,
    manual_row_slot,
    column_key,
    value_text,
    created_at,
    updated_at,
    updated_by
  )
  select
    p_organization_id,
    p_operational_period_key,
    v.manual_row_slot,
    v.column_key,
    v.value_text,
    now(),
    now(),
    p_actor_user_id
  from public.client_operations_manual_row_cell_values v
  where v.organization_id = p_organization_id
    and v.operational_period_key = v_prev
    and v.column_key <> 'folder'
    and length(btrim(v.value_text)) > 0
    and btrim(v.value_text) not in ('—', '–', '-', '־')
    and v.manual_row_slot in (
      select distinct v2.manual_row_slot
      from public.client_operations_manual_row_cell_values v2
      where v2.organization_id = p_organization_id
        and v2.operational_period_key = v_prev
        and v2.column_key <> 'folder'
        and length(btrim(v2.value_text)) > 0
        and btrim(v2.value_text) not in ('—', '–', '-', '־')
    )
  on conflict (organization_id, operational_period_key, manual_row_slot, column_key) do nothing;

  return true;
end;
$$;

comment on function public.initialize_client_operations_manual_rows_for_period(uuid, text, uuid) is
  'CO-179: atomically claim manual-rows period setup and copy meaningful cells from the immediately previous calendar period once.';

revoke all on function public.initialize_client_operations_manual_rows_for_period(uuid, text, uuid) from public;
revoke all on function public.initialize_client_operations_manual_rows_for_period(uuid, text, uuid) from anon, authenticated;
grant execute on function public.initialize_client_operations_manual_rows_for_period(uuid, text, uuid) to service_role;
