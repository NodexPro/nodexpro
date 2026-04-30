-- Module 1 (V1 skeleton): client-operations
-- - Adds module registry entry + module plan
-- - Adds module-specific RBAC permissions
-- - Adds client_operational_profiles table (module data only; shared clients remain the source of truth)

-- =========================
-- 1) MODULE REGISTRATION
-- =========================
insert into public.modules (
  id,
  code,
  name,
  description,
  scope_type,
  is_active,
  is_sellable,
  default_visibility,
  version,
  category,
  schema_version,
  migration_version,
  nav_label,
  nav_path,
  nav_order,
  is_system
) values (
  'f1000000-0000-4000-8000-000000000006',
  'client-operations',
  'Client Operations',
  'Client operations for accounting offices',
  'global',
  true,
  true,
  'visible',
  '1.0.0',
  'operations',
  '1',
  '0',
  'Client Operations',
  '/m/client-operations',
  27,
  false
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  is_sellable = excluded.is_sellable,
  default_visibility = excluded.default_visibility,
  version = excluded.version,
  category = excluded.category,
  schema_version = excluded.schema_version,
  migration_version = excluded.migration_version,
  nav_label = excluded.nav_label,
  nav_path = excluded.nav_path,
  nav_order = excluded.nav_order,
  is_system = excluded.is_system;

-- Seed one plan so commercial activation flow works.
insert into public.module_plans (module_id, code, name, billing_period, currency, price_amount, sort_order)
select m.id, 'standard', 'Standard', 'month', 'ILS', 99, 1
from public.modules m
where m.code = 'client-operations'
on conflict (module_id, code) do update set
  name = excluded.name,
  price_amount = excluded.price_amount,
  sort_order = excluded.sort_order;

-- =========================
-- 2) MODULE PERMISSIONS
-- =========================
insert into public.permissions (id, code, name, domain) values
  ('b0000000-0000-4000-8000-000000000030', 'client_operations.view', 'View client operations', 'client_operations'),
  ('b0000000-0000-4000-8000-000000000031', 'client_operations.edit', 'Edit client operations', 'client_operations')
on conflict (code) do nothing;

-- RBAC: add permission codes to existing organization roles.
insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner', 'client_operations.view'),
  ('owner', 'client_operations.edit'),
  ('admin', 'client_operations.view'),
  ('admin', 'client_operations.edit'),
  ('staff', 'client_operations.view'),
  ('staff', 'client_operations.edit'),
  ('viewer', 'client_operations.view')
on conflict (role_code, permission_code) do nothing;

-- =========================
-- 3) MODULE DATA TABLE
-- =========================
create table if not exists public.client_operational_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,

  business_type text null,
  payroll_flag boolean null,
  material_brought_flag boolean null,
  vat_status text null,
  income_tax_advance_status text null,
  national_insurance_status text null,
  national_insurance_deductions_status text null,
  income_tax_deductions_status text null,
  assigned_handler_user_id uuid null references public.users(id) on delete set null,
  notes_summary text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(organization_id, client_id)
);

create index if not exists idx_client_operational_profiles_org_client
  on public.client_operational_profiles(organization_id, client_id);

create trigger client_operational_profiles_updated_at
before update on public.client_operational_profiles
for each row execute function public.set_updated_at();

alter table public.client_operational_profiles enable row level security;

create policy "client_operational_profiles_select_org_member" on public.client_operational_profiles
  for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_operational_profiles_insert_org_member" on public.client_operational_profiles
  for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_operational_profiles_update_org_member" on public.client_operational_profiles
  for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_operational_profiles_delete_org_member" on public.client_operational_profiles
  for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

