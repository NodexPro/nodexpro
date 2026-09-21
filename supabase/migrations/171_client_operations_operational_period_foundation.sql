-- Client Operations Phase 1 — operational period foundation.
-- Owns: operational_period_key (YYYY-MM) snapshots + period-scoped VAT material facts.
-- Does NOT backfill invented history from current settings.
-- Does NOT change Country Pack / Work Engine / Accounting Base truth.

-- A) Applicability/configuration snapshot (immutable once written for org+client+period)
create table if not exists public.client_operations_period_applicability_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  operational_period_key text not null
    check (operational_period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),

  -- Canonical inputs frozen at first open of this operational period for this client
  vat_type text null,
  vat_frequency text null,
  payroll_flag boolean null,
  income_tax_advance_enabled boolean null,
  income_tax_advance_frequency text null,
  income_tax_deductions_enabled boolean null,
  income_tax_deductions_frequency text null,
  national_insurance_type text null,
  national_insurance_monthly_amount numeric null,
  national_insurance_deductions_file_number text null,

  -- Backend-computed applicability results for this operational period (not FE)
  vat_applicable boolean not null default false,
  payroll_applicable boolean not null default false,
  income_tax_advance_applicable boolean not null default false,
  income_tax_deductions_applicable boolean not null default false,
  national_insurance_applicable boolean not null default false,
  national_insurance_deductions_applicable boolean not null default false,
  row_visible boolean not null default false,

  client_created_at timestamptz null,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, client_id, operational_period_key)
);

comment on table public.client_operations_period_applicability_snapshots is
  'Client Operations period applicability snapshot. Frozen after first capture; not rewritten when current settings change.';

create index if not exists idx_co_period_appl_snap_org_period
  on public.client_operations_period_applicability_snapshots (organization_id, operational_period_key);

create index if not exists idx_co_period_appl_snap_org_client
  on public.client_operations_period_applicability_snapshots (organization_id, client_id);

create trigger client_operations_period_applicability_snapshots_updated_at
  before update on public.client_operations_period_applicability_snapshots
  for each row execute function public.set_updated_at();

alter table public.client_operations_period_applicability_snapshots enable row level security;

create policy "co_period_appl_snap_select_org_member"
  on public.client_operations_period_applicability_snapshots for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_period_appl_snap_insert_org_member"
  on public.client_operations_period_applicability_snapshots for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_period_appl_snap_update_org_member"
  on public.client_operations_period_applicability_snapshots for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_period_appl_snap_delete_org_member"
  on public.client_operations_period_applicability_snapshots for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

-- Prevent rewriting frozen applicability inputs/results after capture
create or replace function public.client_operations_period_applicability_snapshots_freeze()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'UPDATE' then
    if NEW.vat_type is distinct from OLD.vat_type
      or NEW.vat_frequency is distinct from OLD.vat_frequency
      or NEW.payroll_flag is distinct from OLD.payroll_flag
      or NEW.income_tax_advance_enabled is distinct from OLD.income_tax_advance_enabled
      or NEW.income_tax_advance_frequency is distinct from OLD.income_tax_advance_frequency
      or NEW.income_tax_deductions_enabled is distinct from OLD.income_tax_deductions_enabled
      or NEW.income_tax_deductions_frequency is distinct from OLD.income_tax_deductions_frequency
      or NEW.national_insurance_type is distinct from OLD.national_insurance_type
      or NEW.national_insurance_monthly_amount is distinct from OLD.national_insurance_monthly_amount
      or NEW.national_insurance_deductions_file_number is distinct from OLD.national_insurance_deductions_file_number
      or NEW.vat_applicable is distinct from OLD.vat_applicable
      or NEW.payroll_applicable is distinct from OLD.payroll_applicable
      or NEW.income_tax_advance_applicable is distinct from OLD.income_tax_advance_applicable
      or NEW.income_tax_deductions_applicable is distinct from OLD.income_tax_deductions_applicable
      or NEW.national_insurance_applicable is distinct from OLD.national_insurance_applicable
      or NEW.national_insurance_deductions_applicable is distinct from OLD.national_insurance_deductions_applicable
      or NEW.row_visible is distinct from OLD.row_visible
      or NEW.client_created_at is distinct from OLD.client_created_at
      or NEW.captured_at is distinct from OLD.captured_at
      or NEW.operational_period_key is distinct from OLD.operational_period_key
      or NEW.client_id is distinct from OLD.client_id
      or NEW.organization_id is distinct from OLD.organization_id
    then
      raise exception 'CLIENT_OPERATIONS_PERIOD_SNAPSHOT_IMMUTABLE'
        using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_co_period_appl_snap_freeze on public.client_operations_period_applicability_snapshots;
create trigger trg_co_period_appl_snap_freeze
  before update on public.client_operations_period_applicability_snapshots
  for each row execute function public.client_operations_period_applicability_snapshots_freeze();

-- B) Editable period operational fact: חומר למע״מ
create table if not exists public.client_operations_period_material_facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  operational_period_key text not null
    check (operational_period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  material_brought boolean not null default false,
  updated_by_user_id uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id, operational_period_key)
);

comment on table public.client_operations_period_material_facts is
  'Client Operations period-scoped VAT material (חומר למע״מ). Editable operational fact; not an applicability snapshot.';

create index if not exists idx_co_period_material_org_period
  on public.client_operations_period_material_facts (organization_id, operational_period_key);

create index if not exists idx_co_period_material_org_client
  on public.client_operations_period_material_facts (organization_id, client_id);

create trigger client_operations_period_material_facts_updated_at
  before update on public.client_operations_period_material_facts
  for each row execute function public.set_updated_at();

alter table public.client_operations_period_material_facts enable row level security;

create policy "co_period_material_select_org_member"
  on public.client_operations_period_material_facts for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_period_material_insert_org_member"
  on public.client_operations_period_material_facts for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_period_material_update_org_member"
  on public.client_operations_period_material_facts for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_period_material_delete_org_member"
  on public.client_operations_period_material_facts for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
