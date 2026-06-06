-- INC — recurring document profiles (retainer templates; not Accounting Base financial truth).

create table if not exists public.income_recurring_document_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  represented_client_id uuid not null references public.clients(id) on delete cascade,
  issuer_business_id uuid not null,
  acting_mode text not null default 'office_representative'
    check (acting_mode in ('self', 'office_representative')),
  end_customer_id uuid not null references public.income_customers(id) on delete cascade,
  document_type text not null check (
    document_type in ('quote', 'deal_invoice', 'tax_invoice')
  ),
  frequency text not null check (frequency in ('monthly', 'semi_annual', 'yearly')),
  next_document_date date not null,
  advance_days integer not null default 30 check (advance_days >= 0 and advance_days <= 365),
  service_period_start date not null,
  service_period_end date not null,
  auto_advance_period boolean not null default true,
  line_description_template text not null,
  quantity numeric(14, 4) not null default 1 check (quantity > 0),
  unit_price_before_vat_reference numeric(14, 2) not null check (unit_price_before_vat_reference >= 0),
  currency text not null default 'ILS',
  discount_percent_reference numeric(7, 4) null check (
    discount_percent_reference is null
    or (discount_percent_reference >= 0 and discount_percent_reference <= 100)
  ),
  discount_amount_reference numeric(14, 2) null check (
    discount_amount_reference is null or discount_amount_reference >= 0
  ),
  price_increase_enabled boolean not null default false,
  price_increase_type text null check (price_increase_type in ('percent', 'amount')),
  price_increase_value numeric(14, 4) null check (price_increase_value is null or price_increase_value >= 0),
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  last_generated_document_id uuid null references public.income_documents(id) on delete set null,
  last_generated_draft_id uuid null references public.income_document_drafts(id) on delete set null,
  created_by_user_id uuid null references public.users(id) on delete set null,
  updated_by_user_id uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint income_recurring_document_profiles_issuer_matches_client check (
    issuer_business_id = represented_client_id
  ),
  constraint income_recurring_document_profiles_price_increase_pair check (
    (price_increase_enabled = false and price_increase_type is null and price_increase_value is null)
    or (
      price_increase_enabled = true
      and price_increase_type is not null
      and price_increase_value is not null
    )
  )
);

create unique index if not exists uq_income_recurring_profiles_active_customer
  on public.income_recurring_document_profiles (organization_id, represented_client_id, end_customer_id)
  where status in ('active', 'paused');

create index if not exists idx_income_recurring_profiles_org_client
  on public.income_recurring_document_profiles (organization_id, represented_client_id);

create index if not exists idx_income_recurring_profiles_next_date
  on public.income_recurring_document_profiles (organization_id, status, next_document_date);

drop trigger if exists income_recurring_document_profiles_updated_at
  on public.income_recurring_document_profiles;
create trigger income_recurring_document_profiles_updated_at
  before update on public.income_recurring_document_profiles
  for each row execute function public.set_updated_at();

alter table public.income_recurring_document_profiles enable row level security;

drop policy if exists "income_recurring_profiles_select_org_member"
  on public.income_recurring_document_profiles;
create policy "income_recurring_profiles_select_org_member"
  on public.income_recurring_document_profiles for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

drop policy if exists "income_recurring_profiles_insert_org_member"
  on public.income_recurring_document_profiles;
create policy "income_recurring_profiles_insert_org_member"
  on public.income_recurring_document_profiles for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

drop policy if exists "income_recurring_profiles_update_org_member"
  on public.income_recurring_document_profiles;
create policy "income_recurring_profiles_update_org_member"
  on public.income_recurring_document_profiles for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));
