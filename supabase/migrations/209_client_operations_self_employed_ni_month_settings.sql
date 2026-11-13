-- Additive. Do not apply to production without explicit approval.
-- Client Operations office handling method for self-employed National Insurance,
-- stored independently per accounting-office client and operational month.
-- Not a statutory due date, bank verification, or Accounting Base payment.
-- TEMPORARY_COUNTRY_PACK_PENDING: the 15th reminder is an internal office threshold.
--
-- Ownership: (organization_id, client_id, period_key).
-- The client's identity number lives on the canonical clients row and is NOT
-- stored here, logged, or used as a key. Offices are never merged by identity number.
--
-- NULL handling_method on an existing row = explicit unresolved for that month
-- (do not inherit). Absence of a row = inherit forward-only from an earlier month,
-- else legacy national_insurance_standing_order_until coverage, else unresolved.
--
-- Do not backfill monthly rows from standing_order_until. Year-level coverage is
-- ambiguous month-by-month and must remain source standing_until at read time.
-- national_insurance_standing_order_until is preserved as read-only legacy evidence.
--
-- This file replaces the unpublished year-level columns draft of 209
-- (national_insurance_self_employed_handling_method / _year on client_tax_settings).
-- Those columns were never applied in production and are not created here.
-- If a local database already applied the old unpublished 209, those leftover
-- columns are unused and must not be backfilled or treated as monthly truth.
--
-- Dependencies: public.organizations, public.clients, public.users,
-- public.set_updated_at(), public.organizations_for_current_auth_user()
-- (all exist before 208). Numbering: after 208_accounting_tax_obligation_payment_facts.
--
-- Lock risk: CREATE TABLE / indexes / RLS on a new empty relation only.
-- No ALTER of client_tax_settings, client_obligations, or clients.
-- No ACCESS EXCLUSIVE on existing production tables. No backfill rewrite.
--
-- Rollback (data written after apply is lost; until-column history is untouched):
--   drop table if exists public.client_operations_self_employed_ni_month_settings;

create table if not exists public.client_operations_self_employed_ni_month_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  period_key text not null,
  handling_method text null,
  updated_by uuid null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_operations_se_ni_month_settings_org_client_period_key
    unique (organization_id, client_id, period_key),
  constraint client_operations_se_ni_month_settings_period_key_check
    check (period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint client_operations_se_ni_month_settings_method_check
    check (
      handling_method is null
      or handling_method in ('standing_order', 'client_pays', 'manual_monthly')
    )
);

comment on table public.client_operations_self_employed_ni_month_settings is
  'Per-office, per-client, per-month self-employed NI handling method. Not payment truth. Not identity-number keyed. TEMPORARY_COUNTRY_PACK_PENDING reminder threshold is applied in API, not here.';

comment on column public.client_operations_self_employed_ni_month_settings.handling_method is
  'standing_order | client_pays | manual_monthly. NULL on a row = explicit unresolved for this month. Missing row inherits forward-only.';

comment on column public.client_operations_self_employed_ni_month_settings.period_key is
  'Operational month YYYY-MM. Changing one month must never rewrite another month.';

create index if not exists idx_co_se_ni_month_settings_org_client_period
  on public.client_operations_self_employed_ni_month_settings (organization_id, client_id, period_key);

drop trigger if exists client_operations_se_ni_month_settings_updated_at
  on public.client_operations_self_employed_ni_month_settings;
create trigger client_operations_se_ni_month_settings_updated_at
  before update on public.client_operations_self_employed_ni_month_settings
  for each row execute function public.set_updated_at();

alter table public.client_operations_self_employed_ni_month_settings enable row level security;

drop policy if exists client_operations_se_ni_month_settings_select_org_member
  on public.client_operations_self_employed_ni_month_settings;
create policy client_operations_se_ni_month_settings_select_org_member
  on public.client_operations_self_employed_ni_month_settings for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

drop policy if exists client_operations_se_ni_month_settings_insert_org_member
  on public.client_operations_self_employed_ni_month_settings;
create policy client_operations_se_ni_month_settings_insert_org_member
  on public.client_operations_self_employed_ni_month_settings for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

drop policy if exists client_operations_se_ni_month_settings_update_org_member
  on public.client_operations_self_employed_ni_month_settings;
create policy client_operations_se_ni_month_settings_update_org_member
  on public.client_operations_self_employed_ni_month_settings for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

revoke all on table public.client_operations_self_employed_ni_month_settings from public, anon, authenticated;
