-- TAX-F2B1 — Tax Advisory case foundation (tenant persistence).
-- Tax Brain reserved migration range: 600–699.
-- Does not alter migrations 600–614.
-- Scope: tax_advisory_cases, tax_advisory_case_facts, RLS/grants, module + RBAC.
-- No scenarios, evaluation snapshots, K3/K4/Strategy, Accounting Base, Work Engine, DocFlow, AI.

-- ==================================================
-- 1) Module + RBAC
-- ==================================================

-- Module registry columns match public.modules as created in 001_core_schema.sql.
-- Do not write later optional registry fields: they are absent on authorized DEV.
insert into public.modules (
  id,
  code,
  name,
  description,
  scope_type,
  is_active,
  is_sellable,
  default_visibility
) values (
  'f1000000-0000-4000-8000-000000000007',
  'tax-advisory',
  'Tax Advisory',
  'Tenant tax advisory cases and fact answers (Business Setup first workflow)',
  'global',
  true,
  true,
  'visible'
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  is_sellable = excluded.is_sellable,
  default_visibility = excluded.default_visibility;

-- module_plans exists only after 008. Skip when that table is not present.
do $$
begin
  if to_regclass('public.module_plans') is not null then
    insert into public.module_plans (module_id, code, name, billing_period, currency, price_amount, sort_order)
    select m.id, 'standard', 'Standard', 'month', 'ILS', 0, 1
    from public.modules m
    where m.code = 'tax-advisory'
    on conflict (module_id, code) do update set
      name = excluded.name,
      price_amount = excluded.price_amount,
      sort_order = excluded.sort_order;
  end if;
end $$;

insert into public.permissions (id, code, name, domain) values
  ('b0000000-0000-4000-8000-000000000032', 'tax_advisory.view', 'View tax advisory cases', 'tax_advisory'),
  ('b0000000-0000-4000-8000-000000000033', 'tax_advisory.edit', 'Edit tax advisory cases', 'tax_advisory')
on conflict (code) do nothing;

-- Canonical DEV permission attach: 001/003/006 role_permissions (role_id, permission_id).
-- owner/admin/staff/member/admin_manager → view+edit; viewer → view only.
-- Missing role codes are skipped (003 may only have admin/member/viewer).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'tax_advisory.view'
where r.code in ('owner', 'admin', 'admin_manager', 'staff', 'member', 'viewer')
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'tax_advisory.edit'
where r.code in ('owner', 'admin', 'admin_manager', 'staff', 'member')
on conflict (role_id, permission_id) do nothing;

-- 022 rbac_role_permissions is absent on authorized DEV. Seed it only when present.
do $$
begin
  if to_regclass('public.rbac_role_permissions') is not null then
    insert into public.rbac_role_permissions (role_code, permission_code) values
      ('owner', 'tax_advisory.view'),
      ('owner', 'tax_advisory.edit'),
      ('admin', 'tax_advisory.view'),
      ('admin', 'tax_advisory.edit'),
      ('staff', 'tax_advisory.view'),
      ('staff', 'tax_advisory.edit'),
      ('viewer', 'tax_advisory.view')
    on conflict (role_code, permission_code) do nothing;
  end if;
end $$;

-- ==================================================
-- 2) tax_advisory_cases
-- ==================================================

create table if not exists public.tax_advisory_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  country_code char(2) not null references public.countries(code) on delete restrict,
  workflow_type text not null,
  lifecycle_state text not null,
  as_of date not null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  archived_by uuid null references public.users(id) on delete restrict,
  check (workflow_type = 'business_setup'),
  check (lifecycle_state in ('draft', 'archived')),
  check (
    (lifecycle_state = 'draft' and archived_at is null and archived_by is null)
    or (lifecycle_state = 'archived' and archived_at is not null and archived_by is not null)
  )
);

comment on table public.tax_advisory_cases is
  'F2B1 tenant Tax Advisory case. country_code is an immutable legal-engine snapshot of organization Country Pack country. Not tax residency. Not canonical law. Not Accounting Base.';

comment on column public.tax_advisory_cases.country_code is
  'Frozen organization Country Pack legal country at create. Immutable. Not clients.country_code and not tax residency.';

comment on column public.tax_advisory_cases.workflow_type is
  'F2B1 allows business_setup only. Future workflows reuse this table; do not add a parallel case system.';

create unique index if not exists uq_tax_advisory_cases_id_org_client
  on public.tax_advisory_cases (id, organization_id, client_id);

create unique index if not exists uq_tax_advisory_cases_one_open
  on public.tax_advisory_cases (organization_id, client_id, workflow_type)
  where lifecycle_state is distinct from 'archived';

create index if not exists idx_tax_advisory_cases_org_client
  on public.tax_advisory_cases (organization_id, client_id);

create trigger tax_advisory_cases_updated_at
  before update on public.tax_advisory_cases
  for each row execute function public.set_updated_at();

create or replace function public.tax_advisory_cases_assert_client_org()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.clients c
    where c.id = new.client_id
      and c.organization_id = new.organization_id
  ) then
    raise exception 'tax_advisory_cases.client_id must belong to organization_id';
  end if;
  return new;
end;
$$;

drop trigger if exists tax_advisory_cases_assert_client_org_trg on public.tax_advisory_cases;
create trigger tax_advisory_cases_assert_client_org_trg
  before insert or update of organization_id, client_id on public.tax_advisory_cases
  for each row execute function public.tax_advisory_cases_assert_client_org();

create or replace function public.tax_advisory_cases_guard_write()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.lifecycle_state is distinct from 'draft' then
      raise exception 'tax_advisory_cases must be inserted as draft';
    end if;
    return new;
  end if;

  if old.organization_id is distinct from new.organization_id
     or old.client_id is distinct from new.client_id
     or old.country_code is distinct from new.country_code
     or old.workflow_type is distinct from new.workflow_type
     or old.as_of is distinct from new.as_of
     or old.created_by is distinct from new.created_by
     or old.created_at is distinct from new.created_at then
    raise exception 'tax_advisory_cases identity and country_code are immutable';
  end if;

  if old.lifecycle_state = 'archived' and new.lifecycle_state is distinct from 'archived' then
    raise exception 'archived tax_advisory_cases cannot change lifecycle_state';
  end if;

  if old.lifecycle_state = 'draft' and new.lifecycle_state = 'archived' then
    return new;
  end if;

  if old.lifecycle_state is distinct from new.lifecycle_state then
    raise exception 'unsupported tax_advisory_cases lifecycle transition';
  end if;

  return new;
end;
$$;

drop trigger if exists tax_advisory_cases_guard_write_trg on public.tax_advisory_cases;
create trigger tax_advisory_cases_guard_write_trg
  before insert or update on public.tax_advisory_cases
  for each row execute function public.tax_advisory_cases_guard_write();

create or replace function public.tax_advisory_cases_forbid_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Hard delete is forbidden for tax_advisory_cases. Archive the case.';
end;
$$;

drop trigger if exists tax_advisory_cases_forbid_delete_trg on public.tax_advisory_cases;
create trigger tax_advisory_cases_forbid_delete_trg
  before delete on public.tax_advisory_cases
  for each row execute function public.tax_advisory_cases_forbid_delete();

-- ==================================================
-- 3) tax_advisory_case_facts
-- ==================================================

create table if not exists public.tax_advisory_case_facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null,
  case_id uuid not null,
  fact_definition_id uuid not null references public.tax_fact_definitions(id) on delete restrict,
  fact_definition_version_id uuid not null references public.tax_fact_definition_versions(id) on delete restrict,
  fact_key text not null,
  value_type text not null,
  value_json jsonb not null,
  answered_at timestamptz not null default now(),
  answered_by uuid not null references public.users(id) on delete restrict,
  check (public.tax_fact_key_is_snake_case(fact_key)),
  check (fact_key <> 'evaluation_as_of'),
  check (value_type in ('boolean', 'integer', 'decimal', 'money', 'percentage', 'date', 'enum', 'string')),
  check (jsonb_typeof(value_json) is distinct from 'null'),
  unique (case_id, fact_definition_id),
  constraint tax_advisory_case_facts_case_ownership_fk
    foreign key (case_id, organization_id, client_id)
    references public.tax_advisory_cases (id, organization_id, client_id)
    on delete restrict
);

comment on table public.tax_advisory_case_facts is
  'F2B1 tenant answers pinned to exact Fact Dictionary definition + version. Unanswered = no row. Not legal meaning. No presentation pin. No overlay rows.';

create index if not exists idx_tax_advisory_case_facts_org_case
  on public.tax_advisory_case_facts (organization_id, case_id);

create or replace function public.tax_advisory_case_facts_guard_write()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  case_row public.tax_advisory_cases%rowtype;
  def_country char(2);
  def_key text;
  ver_def uuid;
  ver_type text;
  ver_country char(2);
begin
  if tg_op = 'DELETE' then
    select * into case_row
    from public.tax_advisory_cases c
    where c.id = old.case_id;
    if not found then
      raise exception 'tax_advisory_case_facts parent case not found';
    end if;
    if case_row.lifecycle_state is distinct from 'draft' then
      raise exception 'tax_advisory_case_facts can only be cleared on a draft case';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.organization_id is distinct from new.organization_id
       or old.client_id is distinct from new.client_id
       or old.case_id is distinct from new.case_id
       or old.fact_definition_id is distinct from new.fact_definition_id then
      raise exception 'tax_advisory_case_facts ownership and fact_definition_id are immutable';
    end if;
  end if;

  select * into case_row
  from public.tax_advisory_cases c
  where c.id = new.case_id;
  if not found then
    raise exception 'tax_advisory_case_facts parent case not found';
  end if;
  if case_row.lifecycle_state is distinct from 'draft' then
    raise exception 'tax_advisory_case_facts can only be written on a draft case';
  end if;
  if case_row.organization_id is distinct from new.organization_id
     or case_row.client_id is distinct from new.client_id then
    raise exception 'tax_advisory_case_facts must match parent case org/client';
  end if;

  select d.country_code, d.fact_key
    into def_country, def_key
  from public.tax_fact_definitions d
  where d.id = new.fact_definition_id;
  if not found then
    raise exception 'tax_advisory_case_facts fact_definition_id not found';
  end if;
  if def_country is not null and def_country is distinct from case_row.country_code then
    raise exception 'tax_advisory_case_facts definition country does not match case legal country';
  end if;
  if new.fact_key is distinct from def_key then
    raise exception 'tax_advisory_case_facts.fact_key must match the pinned definition';
  end if;

  select v.tax_fact_definition_id, v.value_type, v.country_code
    into ver_def, ver_type, ver_country
  from public.tax_fact_definition_versions v
  where v.id = new.fact_definition_version_id;
  if not found then
    raise exception 'tax_advisory_case_facts fact_definition_version_id not found';
  end if;
  if ver_def is distinct from new.fact_definition_id then
    raise exception 'tax_advisory_case_facts version must belong to fact_definition_id';
  end if;
  if ver_country is not null and ver_country is distinct from case_row.country_code then
    raise exception 'tax_advisory_case_facts version country does not match case legal country';
  end if;
  if new.value_type is distinct from ver_type then
    raise exception 'tax_advisory_case_facts.value_type must match the pinned version';
  end if;

  return new;
end;
$$;

drop trigger if exists tax_advisory_case_facts_guard_write_trg on public.tax_advisory_case_facts;
create trigger tax_advisory_case_facts_guard_write_trg
  before insert or update or delete on public.tax_advisory_case_facts
  for each row execute function public.tax_advisory_case_facts_guard_write();

-- ==================================================
-- 4) RLS + privilege hardening
-- ==================================================

alter table public.tax_advisory_cases enable row level security;
alter table public.tax_advisory_cases force row level security;
alter table public.tax_advisory_case_facts enable row level security;
alter table public.tax_advisory_case_facts force row level security;

revoke all on table public.tax_advisory_cases from public, anon, authenticated, service_role;
revoke all on table public.tax_advisory_case_facts from public, anon, authenticated, service_role;

grant select, insert, update, delete on table
  public.tax_advisory_cases,
  public.tax_advisory_case_facts
  to service_role;

grant select on table
  public.tax_advisory_cases,
  public.tax_advisory_case_facts
  to authenticated;

create policy "tax_advisory_cases_select_org_member"
  on public.tax_advisory_cases
  for select
  to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "tax_advisory_case_facts_select_org_member"
  on public.tax_advisory_case_facts
  for select
  to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

revoke all on function public.tax_advisory_cases_assert_client_org() from public;
revoke all on function public.tax_advisory_cases_assert_client_org() from anon, authenticated;
revoke all on function public.tax_advisory_cases_guard_write() from public;
revoke all on function public.tax_advisory_cases_guard_write() from anon, authenticated;
revoke all on function public.tax_advisory_cases_forbid_delete() from public;
revoke all on function public.tax_advisory_cases_forbid_delete() from anon, authenticated;
revoke all on function public.tax_advisory_case_facts_guard_write() from public;
revoke all on function public.tax_advisory_case_facts_guard_write() from anon, authenticated;

grant execute on function public.tax_advisory_cases_assert_client_org() to service_role;
grant execute on function public.tax_advisory_cases_guard_write() to service_role;
grant execute on function public.tax_advisory_cases_forbid_delete() to service_role;
grant execute on function public.tax_advisory_case_facts_guard_write() to service_role;
