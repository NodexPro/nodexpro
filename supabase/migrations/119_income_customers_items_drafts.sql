-- INC-2: Income customers, items, and document drafts (operational only — not financial truth).

create table if not exists public.income_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  represented_client_id uuid null references public.clients(id) on delete set null,
  issuer_business_id uuid not null,
  display_name text not null,
  phone text null,
  email text null,
  tax_id text null,
  address_json jsonb null,
  is_one_time boolean not null default false,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by_user_id uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_income_customers_org
  on public.income_customers (organization_id);

create index if not exists idx_income_customers_org_issuer
  on public.income_customers (organization_id, issuer_business_id);

create index if not exists idx_income_customers_org_represented
  on public.income_customers (organization_id, represented_client_id);

create index if not exists idx_income_customers_org_status
  on public.income_customers (organization_id, status);

drop trigger if exists income_customers_updated_at on public.income_customers;
create trigger income_customers_updated_at
  before update on public.income_customers
  for each row execute function public.set_updated_at();

alter table public.income_customers enable row level security;

drop policy if exists "income_customers_select_org_member" on public.income_customers;
create policy "income_customers_select_org_member"
  on public.income_customers for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

drop policy if exists "income_customers_insert_org_member" on public.income_customers;
create policy "income_customers_insert_org_member"
  on public.income_customers for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

drop policy if exists "income_customers_update_org_member" on public.income_customers;
create policy "income_customers_update_org_member"
  on public.income_customers for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create table if not exists public.income_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  represented_client_id uuid null references public.clients(id) on delete set null,
  issuer_business_id uuid not null,
  item_type text not null check (item_type in ('service', 'product')),
  name text not null,
  description text null,
  default_unit_price_reference numeric(14, 2) null,
  currency text null,
  active boolean not null default true,
  created_by_user_id uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_income_items_org
  on public.income_items (organization_id);

create index if not exists idx_income_items_org_issuer
  on public.income_items (organization_id, issuer_business_id);

create index if not exists idx_income_items_org_represented
  on public.income_items (organization_id, represented_client_id);

create table if not exists public.income_document_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  represented_client_id uuid null references public.clients(id) on delete set null,
  issuer_business_id uuid not null,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  acting_mode text not null check (acting_mode in ('self', 'office_representative')),
  document_type text null check (
    document_type is null
    or document_type in (
      'receipt',
      'tax_invoice',
      'tax_invoice_receipt',
      'credit_tax_invoice',
      'deal_invoice',
      'quote'
    )
  ),
  income_customer_id uuid null references public.income_customers(id) on delete set null,
  one_time_customer_snapshot_json jsonb null,
  draft_lines_json jsonb not null default '[]'::jsonb,
  draft_totals_preview_json jsonb null,
  status text not null default 'draft' check (status in ('draft', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz null,
  cancelled_by_user_id uuid null references public.users(id) on delete set null
);

create index if not exists idx_income_document_drafts_org
  on public.income_document_drafts (organization_id);

create index if not exists idx_income_document_drafts_org_issuer
  on public.income_document_drafts (organization_id, issuer_business_id);

create index if not exists idx_income_document_drafts_org_represented
  on public.income_document_drafts (organization_id, represented_client_id);

create index if not exists idx_income_document_drafts_org_status
  on public.income_document_drafts (organization_id, status);

create index if not exists idx_income_document_drafts_org_issuer_status
  on public.income_document_drafts (organization_id, issuer_business_id, status);

drop trigger if exists income_document_drafts_updated_at on public.income_document_drafts;
create trigger income_document_drafts_updated_at
  before update on public.income_document_drafts
  for each row execute function public.set_updated_at();

alter table public.income_document_drafts enable row level security;

drop policy if exists "income_document_drafts_select_org_member" on public.income_document_drafts;
create policy "income_document_drafts_select_org_member"
  on public.income_document_drafts for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

drop policy if exists "income_document_drafts_insert_org_member" on public.income_document_drafts;
create policy "income_document_drafts_insert_org_member"
  on public.income_document_drafts for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

drop policy if exists "income_document_drafts_update_org_member" on public.income_document_drafts;
create policy "income_document_drafts_update_org_member"
  on public.income_document_drafts for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

alter table public.income_items enable row level security;

drop policy if exists "income_items_select_org_member" on public.income_items;
create policy "income_items_select_org_member"
  on public.income_items for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

drop policy if exists "income_items_insert_org_member" on public.income_items;
create policy "income_items_insert_org_member"
  on public.income_items for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

drop policy if exists "income_items_update_org_member" on public.income_items;
create policy "income_items_update_org_member"
  on public.income_items for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));
