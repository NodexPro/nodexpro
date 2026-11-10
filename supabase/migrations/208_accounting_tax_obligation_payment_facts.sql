-- Accounting Base: user-attested tax-obligation payment facts.
-- Not a bank-verified ledger posting. Amounts are optional and must not be invented.
-- Filing truth stays on client_obligations; this table is payment classification only.

insert into public.permissions (code, name, domain) values
  ('accounting_base.tax_payment_attestation.write', 'Attest tax-obligation payment classification', 'core')
on conflict (code) do nothing;

insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner', 'accounting_base.tax_payment_attestation.write'),
  ('admin', 'accounting_base.tax_payment_attestation.write'),
  ('staff', 'accounting_base.tax_payment_attestation.write')
on conflict (role_code, permission_code) do nothing;

create table if not exists public.accounting_tax_obligation_payment_facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  obligation_canonical_id text not null,
  obligation_kind text not null,
  operational_period_key text not null,
  obligation_period_key text null,
  source_obligation_id uuid null,
  payment_classification text not null
    check (payment_classification in ('paid_in_full', 'outstanding', 'partially_paid', 'not_required')),
  provenance text not null default 'user_attested'
    check (provenance in ('user_attested')),
  bank_verified boolean not null default false,
  amount_paid numeric(14, 2) null,
  amount_remaining numeric(14, 2) null,
  payment_due_date date null,
  attested_by uuid not null references public.users(id) on delete restrict,
  attested_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounting_tax_obligation_payment_facts_org_client_canonical_unique
    unique (organization_id, client_id, obligation_canonical_id),
  check (bank_verified = false),
  check (amount_paid is null or amount_paid >= 0),
  check (amount_remaining is null or amount_remaining >= 0),
  check (btrim(obligation_canonical_id) <> ''),
  check (btrim(operational_period_key) <> '')
);

create index if not exists idx_accounting_tax_obl_pay_facts_org_client
  on public.accounting_tax_obligation_payment_facts (organization_id, client_id);

create index if not exists idx_accounting_tax_obl_pay_facts_org_class
  on public.accounting_tax_obligation_payment_facts (organization_id, payment_classification);

create index if not exists idx_accounting_tax_obl_pay_facts_org_period
  on public.accounting_tax_obligation_payment_facts (organization_id, operational_period_key);

drop trigger if exists accounting_tax_obligation_payment_facts_updated_at
  on public.accounting_tax_obligation_payment_facts;
create trigger accounting_tax_obligation_payment_facts_updated_at
  before update on public.accounting_tax_obligation_payment_facts
  for each row execute function public.set_updated_at();

drop trigger if exists accounting_tax_obligation_payment_facts_org_immutable
  on public.accounting_tax_obligation_payment_facts;
create trigger accounting_tax_obligation_payment_facts_org_immutable
  before update on public.accounting_tax_obligation_payment_facts
  for each row execute function public.accounting_base_guard_org_immutable();

alter table public.accounting_tax_obligation_payment_facts enable row level security;

drop policy if exists accounting_tax_obligation_payment_facts_select_org_member
  on public.accounting_tax_obligation_payment_facts;
create policy accounting_tax_obligation_payment_facts_select_org_member
  on public.accounting_tax_obligation_payment_facts for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

drop policy if exists accounting_tax_obligation_payment_facts_insert_org_member
  on public.accounting_tax_obligation_payment_facts;
create policy accounting_tax_obligation_payment_facts_insert_org_member
  on public.accounting_tax_obligation_payment_facts for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

drop policy if exists accounting_tax_obligation_payment_facts_update_org_member
  on public.accounting_tax_obligation_payment_facts;
create policy accounting_tax_obligation_payment_facts_update_org_member
  on public.accounting_tax_obligation_payment_facts for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));
