-- Client Operations: period-aware user Excel columns (visibility + values + setup + legacy baseline).
-- Does NOT assign legacy timeless values to any period. Does NOT delete legacy rows.
-- Does NOT reapply 172–176.

-- ---------------------------------------------------------------------------
-- Definition preference: future preselect (OPTION B) + legacy baseline marker
-- ---------------------------------------------------------------------------
alter table public.client_operations_registry_custom_columns
  add column if not exists auto_extend_to_future boolean not null default false;

alter table public.client_operations_registry_custom_columns
  add column if not exists auto_extend_from_period_key text null
  check (
    auto_extend_from_period_key is null
    or auto_extend_from_period_key ~ '^\d{4}-(0[1-9]|1[0-2])$'
  );

alter table public.client_operations_registry_custom_columns
  add column if not exists legacy_baseline_period_key text null
  check (
    legacy_baseline_period_key is null
    or legacy_baseline_period_key ~ '^\d{4}-(0[1-9]|1[0-2])$'
  );

alter table public.client_operations_registry_custom_columns
  add column if not exists legacy_baseline_completed_at timestamptz null;

comment on column public.client_operations_registry_custom_columns.auto_extend_to_future is
  'If true, column is PRECHECKED in new-period setup when period >= auto_extend_from_period_key (OPTION B).';
comment on column public.client_operations_registry_custom_columns.legacy_baseline_period_key is
  'User-chosen first period for copying timeless legacy values; null = not transitioned.';

-- ---------------------------------------------------------------------------
-- Period visibility membership
-- ---------------------------------------------------------------------------
create table if not exists public.client_operations_registry_custom_column_period_visibility (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  column_id uuid not null references public.client_operations_registry_custom_columns(id) on delete cascade,
  operational_period_key text not null
    check (operational_period_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id) on delete set null,
  primary key (organization_id, column_id, operational_period_key)
);

comment on table public.client_operations_registry_custom_column_period_visibility is
  'User Excel column visible in operational period; uncheck removes row but does not delete period values.';

create index if not exists idx_co_custom_col_period_vis_org_period
  on public.client_operations_registry_custom_column_period_visibility (organization_id, operational_period_key);

create index if not exists idx_co_custom_col_period_vis_org_column
  on public.client_operations_registry_custom_column_period_visibility (organization_id, column_id);

alter table public.client_operations_registry_custom_column_period_visibility enable row level security;

create policy "co_custom_col_period_vis_select_org_member"
  on public.client_operations_registry_custom_column_period_visibility for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_custom_col_period_vis_insert_org_member"
  on public.client_operations_registry_custom_column_period_visibility for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_custom_col_period_vis_update_org_member"
  on public.client_operations_registry_custom_column_period_visibility for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_custom_col_period_vis_delete_org_member"
  on public.client_operations_registry_custom_column_period_visibility for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

-- ---------------------------------------------------------------------------
-- Period-scoped cell values (snapshot copies; never live-link)
-- ---------------------------------------------------------------------------
create table if not exists public.client_operations_registry_custom_column_period_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  column_id uuid not null references public.client_operations_registry_custom_columns(id) on delete cascade,
  operational_period_key text not null
    check (operational_period_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  value_text text null,
  value_number numeric null,
  value_date date null,
  value_bool boolean null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id, column_id, operational_period_key)
);

comment on table public.client_operations_registry_custom_column_period_values is
  'Period-scoped user Excel cell values; edits never rewrite other periods.';

create index if not exists idx_co_custom_col_period_vals_org_period
  on public.client_operations_registry_custom_column_period_values (organization_id, operational_period_key);

create index if not exists idx_co_custom_col_period_vals_org_client_period
  on public.client_operations_registry_custom_column_period_values (organization_id, client_id, operational_period_key);

create index if not exists idx_co_custom_col_period_vals_org_column_period
  on public.client_operations_registry_custom_column_period_values (organization_id, column_id, operational_period_key);

create trigger client_operations_registry_custom_column_period_values_updated_at
  before update on public.client_operations_registry_custom_column_period_values
  for each row execute function public.set_updated_at();

alter table public.client_operations_registry_custom_column_period_values enable row level security;

create policy "co_custom_col_period_vals_select_org_member"
  on public.client_operations_registry_custom_column_period_values for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_custom_col_period_vals_insert_org_member"
  on public.client_operations_registry_custom_column_period_values for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_custom_col_period_vals_update_org_member"
  on public.client_operations_registry_custom_column_period_values for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_custom_col_period_vals_delete_org_member"
  on public.client_operations_registry_custom_column_period_values for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

-- ---------------------------------------------------------------------------
-- First-touch period setup marker (GET reports; command writes)
-- ---------------------------------------------------------------------------
create table if not exists public.client_operations_user_columns_period_setup (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operational_period_key text not null
    check (operational_period_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  initialized_at timestamptz not null default now(),
  initialized_by uuid null references public.users(id) on delete set null,
  primary key (organization_id, operational_period_key)
);

comment on table public.client_operations_user_columns_period_setup is
  'Marks that user-column period setup was confirmed for this org+period; GET never inserts.';

alter table public.client_operations_user_columns_period_setup enable row level security;

create policy "co_user_cols_period_setup_select_org_member"
  on public.client_operations_user_columns_period_setup for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_user_cols_period_setup_insert_org_member"
  on public.client_operations_user_columns_period_setup for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_user_cols_period_setup_update_org_member"
  on public.client_operations_user_columns_period_setup for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_user_cols_period_setup_delete_org_member"
  on public.client_operations_user_columns_period_setup for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
