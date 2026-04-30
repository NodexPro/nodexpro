-- Annual report (דוח שנתי) tab: org-scoped tracker + submissions + notes.

insert into public.permissions (code, name, domain)
values
  ('annual_report_tab.view', 'View client annual report tab', 'client_operations'),
  ('annual_report_tab.edit', 'Edit client annual report tab', 'client_operations')
on conflict (code) do nothing;

insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner', 'annual_report_tab.view'),
  ('owner', 'annual_report_tab.edit'),
  ('admin', 'annual_report_tab.view'),
  ('admin', 'annual_report_tab.edit'),
  ('staff', 'annual_report_tab.view'),
  ('staff', 'annual_report_tab.edit'),
  ('viewer', 'annual_report_tab.view')
on conflict (role_code, permission_code) do nothing;

create table if not exists public.client_annual_report_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  notes text null,
  read_model_version int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id) on delete set null,
  unique (organization_id, client_id)
);

create index if not exists idx_client_annual_report_profiles_org_client
  on public.client_annual_report_profiles (organization_id, client_id);

create trigger client_annual_report_profiles_updated_at
  before update on public.client_annual_report_profiles
  for each row execute function public.set_updated_at();

create table if not exists public.client_annual_document_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  source_type text not null check (source_type in ('system', 'custom')),
  system_key text null,
  document_name_he text not null,
  sort_order int not null default 0,
  received boolean not null default false,
  row_note text null,
  file_asset_id uuid null references public.file_assets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Full unique index (not partial): required for PostgREST upsert ON CONFLICT (organization_id, client_id, system_key).
-- Custom rows use system_key NULL; PostgreSQL treats multiple NULLs as distinct in a multicolumn unique index.
create unique index if not exists uq_client_annual_document_rows_org_client_system
  on public.client_annual_document_rows (organization_id, client_id, system_key);

create index if not exists idx_client_annual_document_rows_org_client
  on public.client_annual_document_rows (organization_id, client_id);

create trigger client_annual_document_rows_updated_at
  before update on public.client_annual_document_rows
  for each row execute function public.set_updated_at();

create table if not exists public.client_annual_submission_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  tax_year int not null,
  submitted_on date not null,
  status text not null default 'submitted',
  note text null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_client_annual_submission_rows_org_client
  on public.client_annual_submission_rows (organization_id, client_id);

create trigger client_annual_submission_rows_updated_at
  before update on public.client_annual_submission_rows
  for each row execute function public.set_updated_at();

alter table public.client_annual_report_profiles enable row level security;
alter table public.client_annual_document_rows enable row level security;
alter table public.client_annual_submission_rows enable row level security;

create policy "client_annual_report_profiles_select_org_member"
  on public.client_annual_report_profiles for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_annual_report_profiles_insert_org_member"
  on public.client_annual_report_profiles for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_annual_report_profiles_update_org_member"
  on public.client_annual_report_profiles for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_annual_report_profiles_delete_org_member"
  on public.client_annual_report_profiles for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_annual_document_rows_select_org_member"
  on public.client_annual_document_rows for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_annual_document_rows_insert_org_member"
  on public.client_annual_document_rows for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_annual_document_rows_update_org_member"
  on public.client_annual_document_rows for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_annual_document_rows_delete_org_member"
  on public.client_annual_document_rows for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_annual_submission_rows_select_org_member"
  on public.client_annual_submission_rows for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_annual_submission_rows_insert_org_member"
  on public.client_annual_submission_rows for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_annual_submission_rows_update_org_member"
  on public.client_annual_submission_rows for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_annual_submission_rows_delete_org_member"
  on public.client_annual_submission_rows for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
