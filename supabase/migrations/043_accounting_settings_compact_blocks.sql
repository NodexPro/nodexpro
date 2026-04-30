-- Compact accounting settings tab (הגדרות הנה"ח) - 4 backend-driven blocks
-- Reuses client_accounting_settings as parent and adds structured child tables.

alter table public.client_accounting_settings
  add column if not exists expenses_version int not null default 0,
  add column if not exists income_version int not null default 0,
  add column if not exists documents_version int not null default 0,
  add column if not exists vehicles_version int not null default 0,
  add column if not exists has_additional_income boolean not null default false,
  add column if not exists number_of_workplaces int null,
  add column if not exists estimated_monthly_income numeric null,
  add column if not exists other_income_details text null,
  add column if not exists income_management_system text null,
  add column if not exists document_delivery_method text null,
  add column if not exists documents_due_day int null,
  add column if not exists expense_management_system text null,
  add column if not exists expense_system_username text null,
  add column if not exists expense_system_password_encrypted text null,
  add column if not exists documents_income_management_system text null,
  add column if not exists income_system_username text null,
  add column if not exists income_system_password_encrypted text null,
  add column if not exists access_notes text null,
  add column if not exists vehicle_count int null,
  add column if not exists vehicles_business_use_percent int null;

alter table public.client_accounting_settings
  drop constraint if exists client_accounting_settings_number_of_workplaces_min,
  drop constraint if exists client_accounting_settings_estimated_monthly_income_nonneg,
  drop constraint if exists client_accounting_settings_documents_due_day_range,
  drop constraint if exists client_accounting_settings_vehicles_business_use_percent_range,
  drop constraint if exists client_accounting_settings_document_delivery_method_enum;

alter table public.client_accounting_settings
  add constraint client_accounting_settings_number_of_workplaces_min
    check (number_of_workplaces is null or number_of_workplaces >= 1),
  add constraint client_accounting_settings_estimated_monthly_income_nonneg
    check (estimated_monthly_income is null or estimated_monthly_income >= 0),
  add constraint client_accounting_settings_documents_due_day_range
    check (documents_due_day is null or (documents_due_day >= 1 and documents_due_day <= 31)),
  add constraint client_accounting_settings_vehicles_business_use_percent_range
    check (vehicles_business_use_percent is null or (vehicles_business_use_percent >= 0 and vehicles_business_use_percent <= 100)),
  add constraint client_accounting_settings_document_delivery_method_enum
    check (
      document_delivery_method is null
      or document_delivery_method in ('email', 'whatsapp', 'upload', 'manual', 'mixed')
    );

create table if not exists public.client_accounting_expense_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  expense_type_code text not null,
  business_percent int not null check (business_percent >= 0 and business_percent <= 100),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id, expense_type_code)
);

create index if not exists idx_client_accounting_expense_items_org_client
  on public.client_accounting_expense_items (organization_id, client_id, sort_order);

create trigger client_accounting_expense_items_updated_at
  before update on public.client_accounting_expense_items
  for each row execute function public.set_updated_at();

alter table public.client_accounting_expense_items enable row level security;

create policy "client_accounting_expense_items_select_org_member"
  on public.client_accounting_expense_items for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "client_accounting_expense_items_insert_org_member"
  on public.client_accounting_expense_items for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "client_accounting_expense_items_update_org_member"
  on public.client_accounting_expense_items for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "client_accounting_expense_items_delete_org_member"
  on public.client_accounting_expense_items for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create table if not exists public.client_accounting_income_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  source_code text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id, source_code)
);

create index if not exists idx_client_accounting_income_sources_org_client
  on public.client_accounting_income_sources (organization_id, client_id, sort_order);

create trigger client_accounting_income_sources_updated_at
  before update on public.client_accounting_income_sources
  for each row execute function public.set_updated_at();

alter table public.client_accounting_income_sources enable row level security;

create policy "client_accounting_income_sources_select_org_member"
  on public.client_accounting_income_sources for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "client_accounting_income_sources_insert_org_member"
  on public.client_accounting_income_sources for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "client_accounting_income_sources_update_org_member"
  on public.client_accounting_income_sources for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "client_accounting_income_sources_delete_org_member"
  on public.client_accounting_income_sources for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create table if not exists public.client_accounting_vehicle_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  vehicle_type_code text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id, vehicle_type_code)
);

create index if not exists idx_client_accounting_vehicle_types_org_client
  on public.client_accounting_vehicle_types (organization_id, client_id, sort_order);

create trigger client_accounting_vehicle_types_updated_at
  before update on public.client_accounting_vehicle_types
  for each row execute function public.set_updated_at();

alter table public.client_accounting_vehicle_types enable row level security;

create policy "client_accounting_vehicle_types_select_org_member"
  on public.client_accounting_vehicle_types for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "client_accounting_vehicle_types_insert_org_member"
  on public.client_accounting_vehicle_types for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "client_accounting_vehicle_types_update_org_member"
  on public.client_accounting_vehicle_types for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "client_accounting_vehicle_types_delete_org_member"
  on public.client_accounting_vehicle_types for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

