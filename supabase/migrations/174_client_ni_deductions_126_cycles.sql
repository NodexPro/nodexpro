-- Client Operations — Form 126 NI deductions reporting-cycle completion facts.
-- Grain is reporting cycle (H1 / ANNUAL), NOT monthly.
-- Do NOT add reported_126 to client_ni_deductions_period.
--
-- Activation (product rule; resolver owns outstanding logic):
--   H1 for year Y      activates in July Y     (covers Jan–Jun Y)
--   ANNUAL for year Y  activates in January Y+1 (covers calendar year Y)
-- Once activated, a cycle stays outstanding until completed=true.
--
-- Historical derivation bound (resolver, not this table):
--   earliest client_operations_period_applicability_snapshots row where
--   national_insurance_deductions_applicable = true.
-- Derived missing cycles require coverage_end >= that boundary.
--
-- Tenant isolation: composite FK (client_id, organization_id) → clients(id, organization_id)
-- uses existing unique index uq_clients_id_org from migration 083.
-- No alteration of public.clients is required.
-- DO NOT APPLY until release approval.

create table if not exists public.client_ni_deductions_126_cycles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  reporting_year integer not null check (reporting_year between 1990 and 2200),
  cycle_type text not null check (cycle_type in ('h1', 'annual')),
  completed boolean not null default false,
  completed_at timestamptz null,
  completed_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id) on delete set null,
  unique (organization_id, client_id, reporting_year, cycle_type),
  constraint client_ni_deductions_126_cycles_client_org_fk
    foreign key (client_id, organization_id)
    references public.clients (id, organization_id)
    on delete cascade,
  -- completed_by stays nullable: ON DELETE SET NULL on users, and system actors may omit.
  constraint client_ni_deductions_126_cycles_completion_invariants check (
    (
      completed = false
      and completed_at is null
      and completed_by is null
    )
    or (
      completed = true
      and completed_at is not null
    )
  )
);

comment on table public.client_ni_deductions_126_cycles is
  'Canonical Form 126 NI deductions reporting-cycle completion facts (H1 / ANNUAL). Lazy-materialized on complete. Not monthly.';

comment on column public.client_ni_deductions_126_cycles.reporting_year is
  'Calendar year covered by the cycle (H1 = Jan–Jun of that year; ANNUAL = full that year).';

comment on column public.client_ni_deductions_126_cycles.cycle_type is
  'h1 = January–June cycle (activates July); annual = full-year cycle (activates January of next year).';

comment on column public.client_ni_deductions_126_cycles.completed is
  'Persistent completion truth. Incomplete/absent row means outstanding once the cycle is activated.';

create index if not exists idx_co_ni_126_cycles_org_client
  on public.client_ni_deductions_126_cycles (organization_id, client_id);

create index if not exists idx_co_ni_126_cycles_org_client_incomplete
  on public.client_ni_deductions_126_cycles (organization_id, client_id)
  where completed = false;

create trigger client_ni_deductions_126_cycles_updated_at
  before update on public.client_ni_deductions_126_cycles
  for each row execute function public.set_updated_at();

alter table public.client_ni_deductions_126_cycles enable row level security;

create policy "co_ni_126_cycles_select_org_member"
  on public.client_ni_deductions_126_cycles for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_ni_126_cycles_insert_org_member"
  on public.client_ni_deductions_126_cycles for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_ni_126_cycles_update_org_member"
  on public.client_ni_deductions_126_cycles for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_ni_126_cycles_delete_org_member"
  on public.client_ni_deductions_126_cycles for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
