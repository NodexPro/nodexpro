-- Client Operations — accountant operational target dates for annual report + capital declaration.
-- These are NOT statutory Country Pack deadlines, NOT submitted_on, NOT Work Engine SLA.
-- Do NOT backfill from client_annual_submission_rows.
--
-- Tenant isolation: composite FK (client_id, organization_id) → clients(id, organization_id)
-- uses existing unique index uq_clients_id_org from migration 083 (Accounting Base hardening).
-- No alteration of public.clients is required.

-- A) Annual report tax-year open-work instances
create table if not exists public.client_annual_report_year_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  tax_year integer not null check (tax_year between 1990 and 2200),
  operational_target_date date null,
  status text not null default 'open'
    check (status in ('open', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id) on delete set null,
  unique (organization_id, client_id, tax_year),
  constraint client_annual_report_year_instances_client_org_fk
    foreign key (client_id, organization_id)
    references public.clients (id, organization_id)
    on delete cascade
);

comment on table public.client_annual_report_year_instances is
  'Client Operations open-work annual report instance per tax year. operational_target_date is accountant-managed; not statutory and not submitted_on.';

comment on column public.client_annual_report_year_instances.operational_target_date is
  'Accountant operational target date (DATE). Independent of Country Pack filing_due_date and submission history.';

create index if not exists idx_co_annual_year_inst_org_client
  on public.client_annual_report_year_instances (organization_id, client_id);

create index if not exists idx_co_annual_year_inst_org_year
  on public.client_annual_report_year_instances (organization_id, tax_year);

create trigger client_annual_report_year_instances_updated_at
  before update on public.client_annual_report_year_instances
  for each row execute function public.set_updated_at();

alter table public.client_annual_report_year_instances enable row level security;

create policy "co_annual_year_inst_select_org_member"
  on public.client_annual_report_year_instances for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_annual_year_inst_insert_org_member"
  on public.client_annual_report_year_instances for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_annual_year_inst_update_org_member"
  on public.client_annual_report_year_instances for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_annual_year_inst_delete_org_member"
  on public.client_annual_report_year_instances for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

-- B) Capital declaration requirement/cycle instances
create table if not exists public.client_capital_declaration_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  tax_year integer null check (tax_year is null or (tax_year between 1990 and 2200)),
  label_he text null,
  status text not null default 'open'
    check (status in ('open', 'completed', 'cancelled')),
  operational_target_date date null,
  opened_at timestamptz not null default now(),
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id) on delete set null,
  constraint client_capital_declaration_instances_client_org_fk
    foreign key (client_id, organization_id)
    references public.clients (id, organization_id)
    on delete cascade
);

comment on table public.client_capital_declaration_instances is
  'Canonical capital declaration requirement/cycle instances. Only one OPEN instance per organization+client.';

comment on column public.client_capital_declaration_instances.operational_target_date is
  'Accountant operational target date (DATE). Independent of statutory deadlines and submission history.';

comment on column public.client_capital_declaration_instances.tax_year is
  'Optional attribute only — not unique identity for capital declarations.';

create index if not exists idx_co_capital_decl_inst_org_client_status
  on public.client_capital_declaration_instances (organization_id, client_id, status);

-- Product invariant: at most one OPEN capital declaration per org+client
create unique index if not exists uq_co_capital_decl_inst_one_open_per_client
  on public.client_capital_declaration_instances (organization_id, client_id)
  where status = 'open';

create trigger client_capital_declaration_instances_updated_at
  before update on public.client_capital_declaration_instances
  for each row execute function public.set_updated_at();

alter table public.client_capital_declaration_instances enable row level security;

create policy "co_capital_decl_inst_select_org_member"
  on public.client_capital_declaration_instances for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_capital_decl_inst_insert_org_member"
  on public.client_capital_declaration_instances for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_capital_decl_inst_update_org_member"
  on public.client_capital_declaration_instances for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_capital_decl_inst_delete_org_member"
  on public.client_capital_declaration_instances for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
