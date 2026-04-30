-- מס הכנסה ניכויים — per reporting period (period_key from aggregate resolver; not stored when לא נדרש).

create table if not exists public.client_income_tax_deductions_period (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  period_key text not null,
  reported boolean not null default false,
  paid boolean not null default false,
  not_relevant boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id, period_key)
);

create index if not exists idx_client_income_tax_deductions_period_org_client
  on public.client_income_tax_deductions_period (organization_id, client_id);

create trigger client_income_tax_deductions_period_updated_at
before update on public.client_income_tax_deductions_period
for each row execute function public.set_updated_at();

alter table public.client_income_tax_deductions_period enable row level security;

create policy "client_income_tax_deductions_period_select_org_member" on public.client_income_tax_deductions_period
  for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_income_tax_deductions_period_insert_org_member" on public.client_income_tax_deductions_period
  for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_income_tax_deductions_period_update_org_member" on public.client_income_tax_deductions_period
  for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_income_tax_deductions_period_delete_org_member" on public.client_income_tax_deductions_period
  for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
