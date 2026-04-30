-- Payroll (שכר) tab: aggregate + command-owned persistence.

insert into public.permissions (code, name, domain)
values
  ('payroll_tab.view', 'View client payroll (שכר) tab', 'client_operations'),
  ('payroll_tab.edit', 'Edit client payroll (שכר) tab', 'client_operations')
on conflict (code) do nothing;

insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner', 'payroll_tab.view'),
  ('owner', 'payroll_tab.edit'),
  ('admin', 'payroll_tab.view'),
  ('admin', 'payroll_tab.edit'),
  ('staff', 'payroll_tab.view'),
  ('staff', 'payroll_tab.edit'),
  ('viewer', 'payroll_tab.view')
on conflict (role_code, permission_code) do nothing;

create table if not exists public.client_payroll_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  has_employees boolean null,
  employer_company_name_override text null,
  employer_company_founded_year_override int null,
  employer_city_override text null,
  employer_street_override text null,
  employer_postal_code_override text null,
  employer_phone_override text null,
  employer_email_override text null,
  employer_business_domain_override text null,
  employer_id_bl text null,
  bank_number text null,
  bank_branch text null,
  bank_account text null,
  reporting_income_tax_frequency text null,
  process_payroll_software text null,
  process_data_delivery_method text null,
  process_data_sender text null,
  process_data_received_day text null,
  process_salary_payment_day text null,
  complexity_level text null,
  complexity_requires_fixes boolean null,
  complexity_notes text null,
  employees_count int null,
  employees_graph_json jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id) on delete set null,
  unique (organization_id, client_id)
);

create index if not exists idx_client_payroll_profiles_org_client
  on public.client_payroll_profiles (organization_id, client_id);

create trigger client_payroll_profiles_updated_at
  before update on public.client_payroll_profiles
  for each row execute function public.set_updated_at();

alter table public.client_payroll_profiles enable row level security;

create policy "client_payroll_profiles_select_org_member"
  on public.client_payroll_profiles for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_payroll_profiles_insert_org_member"
  on public.client_payroll_profiles for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_payroll_profiles_update_org_member"
  on public.client_payroll_profiles for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_payroll_profiles_delete_org_member"
  on public.client_payroll_profiles for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
