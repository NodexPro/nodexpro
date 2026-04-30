-- Detailed vehicle fleet per client (רכבים): license, docs, costs — for accountant reference.
create table if not exists public.client_accounting_vehicle_fleet (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  sort_order int not null default 0 check (sort_order >= 0 and sort_order < 20),
  ownership text not null check (ownership in ('business', 'private')),
  license_plate text null,
  license_file_asset_id uuid null references public.file_assets(id) on delete set null,
  comprehensive_insurance_file_asset_id uuid null references public.file_assets(id) on delete set null,
  compulsory_insurance_file_asset_id uuid null references public.file_assets(id) on delete set null,
  manufacture_year int null check (manufacture_year is null or (manufacture_year >= 1950 and manufacture_year <= 2100)),
  vehicle_cost_ils numeric(14, 2) null check (vehicle_cost_ils is null or vehicle_cost_ils >= 0),
  purchase_date date null,
  sale_date date null,
  sale_price_ils numeric(14, 2) null check (sale_price_ils is null or sale_price_ils >= 0),
  vehicle_class text not null check (vehicle_class in ('private_car', 'commercial', 'motorcycle')),
  has_fuel_expenses boolean not null default false,
  has_vehicle_insurance boolean not null default false,
  notes text null check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id, sort_order)
);

create index if not exists idx_client_accounting_vehicle_fleet_org_client
  on public.client_accounting_vehicle_fleet (organization_id, client_id, sort_order);

create trigger client_accounting_vehicle_fleet_updated_at
  before update on public.client_accounting_vehicle_fleet
  for each row execute function public.set_updated_at();

alter table public.client_accounting_vehicle_fleet enable row level security;

create policy "client_accounting_vehicle_fleet_select_org_member"
  on public.client_accounting_vehicle_fleet for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_accounting_vehicle_fleet_insert_org_member"
  on public.client_accounting_vehicle_fleet for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_accounting_vehicle_fleet_update_org_member"
  on public.client_accounting_vehicle_fleet for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_accounting_vehicle_fleet_delete_org_member"
  on public.client_accounting_vehicle_fleet for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

comment on table public.client_accounting_vehicle_fleet is 'רכבים מפורטים (רישיון, ביטוחים, עלויות) ללקוח בהגדרות הנה״ח.';
