-- Accounting / bookkeeping settings per client (הגדרות הנה״ח) + vehicles + profession rules for vehicle VAT defaults.

-- Global rule list (extend via migrations or future admin API — not org-scoped).
create table if not exists public.accounting_vehicle_profession_rules (
  id uuid primary key default gen_random_uuid(),
  profession_name text not null unique,
  vehicle_vat_percent_default numeric(5, 2) not null default 100,
  applies_automatic_default boolean not null default true,
  sort_order int not null default 0
);

comment on table public.accounting_vehicle_profession_rules is 'Backend-managed תחומי עיסוק → default אחוז מע״מ מוכר לרכב (e.g. 100%).';

insert into public.accounting_vehicle_profession_rules (profession_name, vehicle_vat_percent_default, applies_automatic_default, sort_order)
values
  ('שליחויות', 100, true, 1),
  ('הסעת נוסעים', 100, true, 2),
  ('הובלות', 100, true, 3)
on conflict (profession_name) do nothing;

alter table public.accounting_vehicle_profession_rules enable row level security;

create policy "accounting_vehicle_profession_rules_select_auth"
  on public.accounting_vehicle_profession_rules
  for select to authenticated
  using (true);

-- One row per org+client (same pattern as client_tax_settings).
create table if not exists public.client_accounting_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  occupation_field text null,
  business_opened_on date null,
  business_closed_on date null,
  has_vehicles boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id)
);

create index if not exists idx_client_accounting_settings_org_client
  on public.client_accounting_settings (organization_id, client_id);

create trigger client_accounting_settings_updated_at
  before update on public.client_accounting_settings
  for each row execute function public.set_updated_at();

alter table public.client_accounting_settings enable row level security;

create policy "client_accounting_settings_select_org_member"
  on public.client_accounting_settings for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_accounting_settings_insert_org_member"
  on public.client_accounting_settings for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_accounting_settings_update_org_member"
  on public.client_accounting_settings for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_accounting_settings_delete_org_member"
  on public.client_accounting_settings for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create table if not exists public.client_accounting_vehicles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  sort_order int not null default 0 check (sort_order >= 0 and sort_order < 10),
  vehicle_kind text not null check (vehicle_kind in ('business', 'private')),
  license_plate text null,
  manufacture_year int null check (manufacture_year is null or (manufacture_year >= 1900 and manufacture_year <= 2100)),
  engine_type text not null check (engine_type in ('diesel', 'gasoline', 'electric')),
  compulsory_insurance_from date null,
  compulsory_insurance_to date null,
  comprehensive_insurance_from date null,
  comprehensive_insurance_to date null,
  recognized_vat_percent numeric(5, 2) null check (recognized_vat_percent is null or (recognized_vat_percent >= 0 and recognized_vat_percent <= 100)),
  recognized_expense_percent numeric(5, 2) null check (recognized_expense_percent is null or (recognized_expense_percent >= 0 and recognized_expense_percent <= 100)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_client_accounting_vehicles_org_client
  on public.client_accounting_vehicles (organization_id, client_id, sort_order);

create trigger client_accounting_vehicles_updated_at
  before update on public.client_accounting_vehicles
  for each row execute function public.set_updated_at();

alter table public.client_accounting_vehicles enable row level security;

create policy "client_accounting_vehicles_select_org_member"
  on public.client_accounting_vehicles for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_accounting_vehicles_insert_org_member"
  on public.client_accounting_vehicles for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_accounting_vehicles_update_org_member"
  on public.client_accounting_vehicles for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_accounting_vehicles_delete_org_member"
  on public.client_accounting_vehicles for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

-- Audit trail (API uses service role; same pattern as client_tax_settings_event_log).
create table if not exists public.client_accounting_event_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid null references public.users(id) on delete set null,
  action_type text not null,
  detail text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_client_accounting_event_log_client
  on public.client_accounting_event_log (organization_id, client_id, created_at desc);

alter table public.client_accounting_event_log enable row level security;

create policy "client_accounting_event_log_select_org_member"
  on public.client_accounting_event_log for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_accounting_event_log_insert_org_member"
  on public.client_accounting_event_log for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));
