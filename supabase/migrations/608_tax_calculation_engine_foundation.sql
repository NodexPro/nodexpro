-- TAX-K4D — Tax Calculation Engine persistence foundation.
-- Tax Brain reserved migration range: 600–699.
-- Scope: definition identity/versions, definition pins/requirements, immutable runs,
--        run pins, and one SECURITY INVOKER persist RPC.
-- Does not alter migrations 600–607, 086, or 163.
-- No commands, no UI, no tenant/case tables, no Accounting Base writes.
--
-- Ownership:
--   K4 owns calculation definitions, definition versions, and advisory calculation runs.
--   Tax Knowledge owns legal rules / relationships / unresolved references.
--   Country Pack owns statutory legal values.
--   Accounting Base remains financial truth. These runs are advisory history only.
--   Tax Rule Engine owns applicability. This migration does not call it.
--
-- No organization_id / client_id / case_id.
-- No latest-version resolution during persistence.
-- Backend computes expression_checksum / definition_checksum / run checksums.
-- SQL stores and freezes them; it does not hash ASTs or evaluate calculations.

create extension if not exists btree_gist;

-- ==================================================
-- Shared guards
-- ==================================================

create or replace function public.tax_calculation_forbid_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Hard delete is forbidden for tax calculation table %. Use retirement on published versions.', tg_table_name;
end;
$$;

create or replace function public.tax_calculation_forbid_truncate()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'TRUNCATE is forbidden for tax calculation table %.', tg_table_name;
end;
$$;

create or replace function public.tax_calculation_forbid_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'UPDATE is forbidden for immutable tax calculation table %.', tg_table_name;
end;
$$;

-- ==================================================
-- 1) tax_calculation_definitions — stable identity (no lifecycle status)
-- ==================================================

create table if not exists public.tax_calculation_definitions (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null references public.countries(code) on delete restrict,
  calculation_code text not null,
  title text not null,
  description text null,
  owner_note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(calculation_code) <> ''),
  check (btrim(title) <> '')
);

comment on table public.tax_calculation_definitions is
  'K4D platform-canonical calculation identity. Country-scoped. No organization_id. No lifecycle status — versions own draft/active/retired. Advisory calculators only; not Accounting Base financial truth.';

comment on column public.tax_calculation_definitions.calculation_code is
  'Immutable per-country identity code. Display metadata only; excluded from definition_checksum.';

create unique index if not exists uq_tax_calculation_definitions_country_code
  on public.tax_calculation_definitions (country_code, calculation_code);

create unique index if not exists uq_tax_calculation_definitions_id_country
  on public.tax_calculation_definitions (id, country_code);

create index if not exists idx_tax_calculation_definitions_country
  on public.tax_calculation_definitions (country_code);

create trigger tax_calculation_definitions_updated_at
  before update on public.tax_calculation_definitions
  for each row execute function public.set_updated_at();

create or replace function public.tax_calculation_definitions_protect_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.country_code is distinct from new.country_code then
    raise exception 'tax_calculation_definitions.country_code is immutable';
  end if;
  if old.calculation_code is distinct from new.calculation_code then
    raise exception 'tax_calculation_definitions.calculation_code is immutable';
  end if;
  if old.created_at is distinct from new.created_at then
    raise exception 'tax_calculation_definitions.created_at is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists tax_calculation_definitions_identity_guard
  on public.tax_calculation_definitions;
create trigger tax_calculation_definitions_identity_guard
  before update on public.tax_calculation_definitions
  for each row execute function public.tax_calculation_definitions_protect_identity();

drop trigger if exists tax_calculation_definitions_forbid_delete
  on public.tax_calculation_definitions;
create trigger tax_calculation_definitions_forbid_delete
  before delete on public.tax_calculation_definitions
  for each row execute function public.tax_calculation_forbid_delete();

drop trigger if exists tax_calculation_definitions_forbid_truncate
  on public.tax_calculation_definitions;
create trigger tax_calculation_definitions_forbid_truncate
  before truncate on public.tax_calculation_definitions
  execute function public.tax_calculation_forbid_truncate();

-- ==================================================
-- 2) tax_calculation_definition_versions
-- ==================================================

create table if not exists public.tax_calculation_definition_versions (
  id uuid primary key default gen_random_uuid(),
  tax_calculation_definition_id uuid not null,
  country_code char(2) not null,
  version_no integer not null,
  status text not null check (status in ('draft', 'active', 'retired')),
  expression_json jsonb not null,
  expression_checksum text not null,
  definition_checksum text not null,
  engine_dialect text not null,
  engine_dialect_version text not null,
  default_rounding_json jsonb null,
  effective_from date not null,
  effective_to date null,
  created_at timestamptz not null default now(),
  activated_at timestamptz null,
  retired_at timestamptz null,
  retired_reason text null,
  check (version_no >= 1),
  check (btrim(expression_checksum) <> ''),
  check (btrim(definition_checksum) <> ''),
  check (btrim(engine_dialect) <> ''),
  check (btrim(engine_dialect_version) <> ''),
  check (jsonb_typeof(expression_json) = 'object'),
  check (default_rounding_json is null or jsonb_typeof(default_rounding_json) = 'object'),
  check (effective_to is null or effective_to >= effective_from)
);

comment on table public.tax_calculation_definition_versions is
  'K4D versioned calculation publication. Draft mutable; active/retired semantic content immutable. Exact-version historical replay. Backend computes checksums; SQL does not hash ASTs.';

comment on column public.tax_calculation_definition_versions.expression_checksum is
  'Backend-computed SHA-256 of the canonical expression. SQL stores/freezes it and does not compute it.';

comment on column public.tax_calculation_definition_versions.definition_checksum is
  'Backend-computed SHA-256 of published semantic content (country, dialect, expression_checksum, rounding, sorted rule pins, sorted legal-value requirements). Excludes title/dates/lifecycle metadata.';

comment on column public.tax_calculation_definition_versions.effective_from is
  'Publication window for later as_of selection. Excluded from definition_checksum. Replay pins this version id.';

alter table public.tax_calculation_definition_versions
  add constraint tax_calculation_definition_versions_definition_country_fk
  foreign key (tax_calculation_definition_id, country_code)
  references public.tax_calculation_definitions (id, country_code)
  on delete restrict;

create unique index if not exists uq_tax_calculation_definition_versions_def_no
  on public.tax_calculation_definition_versions (tax_calculation_definition_id, version_no);

create unique index if not exists uq_tax_calculation_definition_versions_id_country
  on public.tax_calculation_definition_versions (id, country_code);

create unique index if not exists uq_tax_calculation_definition_versions_id_definition
  on public.tax_calculation_definition_versions (id, tax_calculation_definition_id);

create index if not exists idx_tax_calculation_definition_versions_definition
  on public.tax_calculation_definition_versions (tax_calculation_definition_id);

create index if not exists idx_tax_calculation_definition_versions_country
  on public.tax_calculation_definition_versions (country_code);

create index if not exists idx_tax_calculation_definition_versions_status
  on public.tax_calculation_definition_versions (status);

create index if not exists idx_tax_calculation_definition_versions_effective
  on public.tax_calculation_definition_versions (tax_calculation_definition_id, effective_from, effective_to);

alter table public.tax_calculation_definition_versions
  add constraint tax_calculation_definition_versions_no_active_overlap
  exclude using gist (
    tax_calculation_definition_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  )
  where (status = 'active');

create or replace function public.tax_calculation_definition_versions_guard_country()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (
    select d.country_code
    from public.tax_calculation_definitions d
    where d.id = new.tax_calculation_definition_id
  ) is distinct from new.country_code then
    raise exception 'Cross-country tax calculation definition version binding is forbidden';
  end if;
  return new;
end;
$$;

drop trigger if exists tax_calculation_definition_versions_country_guard
  on public.tax_calculation_definition_versions;
create trigger tax_calculation_definition_versions_country_guard
  before insert or update on public.tax_calculation_definition_versions
  for each row execute function public.tax_calculation_definition_versions_guard_country();

create or replace function public.tax_calculation_definition_versions_guard_monotonic_version_no()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  next_no integer;
begin
  select coalesce(max(v.version_no), 0) + 1
    into next_no
    from public.tax_calculation_definition_versions v
    where v.tax_calculation_definition_id = new.tax_calculation_definition_id;

  if new.version_no <> next_no then
    raise exception
      'tax_calculation_definition_versions.version_no must be monotonic per definition (expected %)',
      next_no;
  end if;
  return new;
end;
$$;

drop trigger if exists tax_calculation_definition_versions_monotonic_version_no_guard
  on public.tax_calculation_definition_versions;
create trigger tax_calculation_definition_versions_monotonic_version_no_guard
  before insert on public.tax_calculation_definition_versions
  for each row execute function public.tax_calculation_definition_versions_guard_monotonic_version_no();

create or replace function public.tax_calculation_definition_versions_guard_insert_draft_only()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status is distinct from 'draft' then
    raise exception 'tax_calculation_definition_versions must be inserted as draft';
  end if;
  return new;
end;
$$;

drop trigger if exists tax_calculation_definition_versions_insert_draft_only
  on public.tax_calculation_definition_versions;
create trigger tax_calculation_definition_versions_insert_draft_only
  before insert on public.tax_calculation_definition_versions
  for each row execute function public.tax_calculation_definition_versions_guard_insert_draft_only();

create or replace function public.tax_calculation_definition_versions_protect_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.created_at is distinct from new.created_at then
    raise exception 'tax_calculation_definition_versions.created_at is immutable';
  end if;

  if old.status is distinct from new.status then
    if not (
      (old.status = 'draft' and new.status in ('active', 'retired'))
      or (old.status = 'active' and new.status = 'retired')
    ) then
      raise exception
        'Invalid tax_calculation_definition_versions status transition: % → %',
        old.status, new.status;
    end if;
    if old.status = 'draft' and new.status = 'active' and new.activated_at is null then
      new.activated_at := now();
    end if;
    if new.status = 'retired' and new.retired_at is null then
      new.retired_at := now();
    end if;
  end if;

  if old.status is distinct from 'draft' then
    if (
      old.tax_calculation_definition_id is distinct from new.tax_calculation_definition_id
      or old.country_code is distinct from new.country_code
      or old.version_no is distinct from new.version_no
      or old.expression_json is distinct from new.expression_json
      or old.expression_checksum is distinct from new.expression_checksum
      or old.definition_checksum is distinct from new.definition_checksum
      or old.engine_dialect is distinct from new.engine_dialect
      or old.engine_dialect_version is distinct from new.engine_dialect_version
      or old.default_rounding_json is distinct from new.default_rounding_json
      or old.effective_from is distinct from new.effective_from
      or old.activated_at is distinct from new.activated_at
    ) then
      raise exception
        'tax_calculation_definition_versions semantic fields are immutable after leaving draft';
    end if;

    if old.status = 'retired' then
      if old.effective_to is distinct from new.effective_to then
        raise exception
          'tax_calculation_definition_versions.effective_to is frozen after retirement';
      end if;
    else
      if old.effective_to is not null then
        if new.effective_to is null then
          raise exception
            'tax_calculation_definition_versions.effective_to cannot be cleared after close-out';
        end if;
        if new.effective_to > old.effective_to then
          raise exception
            'tax_calculation_definition_versions.effective_to cannot be extended after leaving draft';
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tax_calculation_definition_versions_immutability_guard
  on public.tax_calculation_definition_versions;
create trigger tax_calculation_definition_versions_immutability_guard
  before update on public.tax_calculation_definition_versions
  for each row execute function public.tax_calculation_definition_versions_protect_immutability();

drop trigger if exists tax_calculation_definition_versions_forbid_delete
  on public.tax_calculation_definition_versions;
create trigger tax_calculation_definition_versions_forbid_delete
  before delete on public.tax_calculation_definition_versions
  for each row execute function public.tax_calculation_forbid_delete();

drop trigger if exists tax_calculation_definition_versions_forbid_truncate
  on public.tax_calculation_definition_versions;
create trigger tax_calculation_definition_versions_forbid_truncate
  before truncate on public.tax_calculation_definition_versions
  execute function public.tax_calculation_forbid_truncate();

-- ==================================================
-- 3) tax_calculation_definition_rule_pins
-- ==================================================

create table if not exists public.tax_calculation_definition_rule_pins (
  id uuid primary key default gen_random_uuid(),
  calculation_definition_version_id uuid not null,
  tax_rule_version_id uuid not null,
  country_code char(2) not null,
  created_at timestamptz not null default now()
);

comment on table public.tax_calculation_definition_rule_pins is
  'K4D optional exact tax_rule_version pins on a definition version. No primary/supporting role. Same-country only. INSERT/DELETE allowed only while the parent version is draft (unpin). Published child DELETE is forbidden. tax_calculation_forbid_delete is not attached here.';

alter table public.tax_calculation_definition_rule_pins
  add constraint tax_calculation_definition_rule_pins_version_country_fk
  foreign key (calculation_definition_version_id, country_code)
  references public.tax_calculation_definition_versions (id, country_code)
  on delete restrict;

alter table public.tax_calculation_definition_rule_pins
  add constraint tax_calculation_definition_rule_pins_rule_version_country_fk
  foreign key (tax_rule_version_id, country_code)
  references public.tax_rule_versions (id, country_code)
  on delete restrict;

create unique index if not exists uq_tax_calculation_definition_rule_pins_pair
  on public.tax_calculation_definition_rule_pins (
    calculation_definition_version_id,
    tax_rule_version_id
  );

create index if not exists idx_tax_calculation_definition_rule_pins_version
  on public.tax_calculation_definition_rule_pins (calculation_definition_version_id);

create index if not exists idx_tax_calculation_definition_rule_pins_country
  on public.tax_calculation_definition_rule_pins (country_code);

-- ==================================================
-- 4) tax_calculation_definition_legal_value_requirements
-- ==================================================

create table if not exists public.tax_calculation_definition_legal_value_requirements (
  id uuid primary key default gen_random_uuid(),
  calculation_definition_version_id uuid not null,
  legal_value_id uuid not null,
  country_code char(2) not null,
  value_key text not null,
  required boolean not null,
  created_at timestamptz not null default now(),
  check (btrim(value_key) <> '')
);

comment on table public.tax_calculation_definition_legal_value_requirements is
  'K4D stable Country Pack legal_value identities required or optional for a definition version. Not a resolved legal_value_version. Same-country only. INSERT/DELETE allowed only while the parent version is draft (unbind). Published child DELETE is forbidden.';

alter table public.tax_calculation_definition_legal_value_requirements
  add constraint tax_calculation_definition_legal_reqs_version_country_fk
  foreign key (calculation_definition_version_id, country_code)
  references public.tax_calculation_definition_versions (id, country_code)
  on delete restrict;

alter table public.tax_calculation_definition_legal_value_requirements
  add constraint tax_calculation_definition_legal_reqs_legal_value_country_fk
  foreign key (legal_value_id, country_code)
  references public.country_legal_values (id, country_code)
  on delete restrict;

create unique index if not exists uq_tax_calculation_definition_legal_reqs_pair
  on public.tax_calculation_definition_legal_value_requirements (
    calculation_definition_version_id,
    legal_value_id
  );

create index if not exists idx_tax_calculation_definition_legal_reqs_version
  on public.tax_calculation_definition_legal_value_requirements (calculation_definition_version_id);

create index if not exists idx_tax_calculation_definition_legal_reqs_country
  on public.tax_calculation_definition_legal_value_requirements (country_code);

create or replace function public.tax_calculation_definition_child_guard_country()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (
    select v.country_code
    from public.tax_calculation_definition_versions v
    where v.id = new.calculation_definition_version_id
  ) is distinct from new.country_code then
    raise exception 'Cross-country tax calculation definition child binding is forbidden';
  end if;

  if tg_table_name = 'tax_calculation_definition_rule_pins' then
    if (
      select rv.country_code
      from public.tax_rule_versions rv
      where rv.id = new.tax_rule_version_id
    ) is distinct from new.country_code then
      raise exception 'Cross-country tax calculation rule pin is forbidden';
    end if;
  elsif tg_table_name = 'tax_calculation_definition_legal_value_requirements' then
    if (
      select lv.country_code
      from public.country_legal_values lv
      where lv.id = new.legal_value_id
    ) is distinct from new.country_code then
      raise exception 'Cross-country tax calculation legal-value requirement is forbidden';
    end if;
    if (
      select lv.value_key
      from public.country_legal_values lv
      where lv.id = new.legal_value_id
    ) is distinct from new.value_key then
      raise exception
        'tax_calculation_definition_legal_value_requirements.value_key must match country_legal_values.value_key';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tax_calculation_definition_rule_pins_country_guard
  on public.tax_calculation_definition_rule_pins;
create trigger tax_calculation_definition_rule_pins_country_guard
  before insert or update on public.tax_calculation_definition_rule_pins
  for each row execute function public.tax_calculation_definition_child_guard_country();

drop trigger if exists tax_calculation_definition_legal_reqs_country_guard
  on public.tax_calculation_definition_legal_value_requirements;
create trigger tax_calculation_definition_legal_reqs_country_guard
  before insert or update on public.tax_calculation_definition_legal_value_requirements
  for each row execute function public.tax_calculation_definition_child_guard_country();

create or replace function public.tax_calculation_definition_child_requires_parent_draft()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  old_status text;
  new_status text;
begin
  if tg_op = 'DELETE' then
    select v.status into old_status
    from public.tax_calculation_definition_versions v
    where v.id = old.calculation_definition_version_id;
    if old_status is distinct from 'draft' then
      raise exception
        'Tax calculation definition children are immutable after the parent version leaves draft';
    end if;
    return old;
  end if;

  select v.status into new_status
  from public.tax_calculation_definition_versions v
  where v.id = new.calculation_definition_version_id;
  if new_status is distinct from 'draft' then
    raise exception
      'Tax calculation definition children are immutable after the parent version leaves draft';
  end if;

  if tg_op = 'UPDATE' then
    select v.status into old_status
    from public.tax_calculation_definition_versions v
    where v.id = old.calculation_definition_version_id;
    if old_status is distinct from 'draft' then
      raise exception
        'Tax calculation definition children are immutable after the parent version leaves draft';
    end if;
    if old.created_at is distinct from new.created_at then
      raise exception '%.created_at is immutable', tg_table_name;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tax_calculation_definition_rule_pins_parent_draft_guard
  on public.tax_calculation_definition_rule_pins;
create trigger tax_calculation_definition_rule_pins_parent_draft_guard
  before insert or update or delete on public.tax_calculation_definition_rule_pins
  for each row execute function public.tax_calculation_definition_child_requires_parent_draft();

drop trigger if exists tax_calculation_definition_legal_reqs_parent_draft_guard
  on public.tax_calculation_definition_legal_value_requirements;
create trigger tax_calculation_definition_legal_reqs_parent_draft_guard
  before insert or update or delete on public.tax_calculation_definition_legal_value_requirements
  for each row execute function public.tax_calculation_definition_child_requires_parent_draft();

drop trigger if exists tax_calculation_definition_rule_pins_forbid_truncate
  on public.tax_calculation_definition_rule_pins;
create trigger tax_calculation_definition_rule_pins_forbid_truncate
  before truncate on public.tax_calculation_definition_rule_pins
  execute function public.tax_calculation_forbid_truncate();

drop trigger if exists tax_calculation_definition_legal_reqs_forbid_truncate
  on public.tax_calculation_definition_legal_value_requirements;
create trigger tax_calculation_definition_legal_reqs_forbid_truncate
  before truncate on public.tax_calculation_definition_legal_value_requirements
  execute function public.tax_calculation_forbid_truncate();

-- Structural publication only. Does not parse expression_json for legal_value AST nodes.
create or replace function public.tax_calculation_definition_versions_guard_publication()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.status is distinct from 'draft' or new.status is distinct from 'active' then
    return new;
  end if;

  if exists (
    select 1
    from public.tax_calculation_definition_rule_pins pin
    join public.tax_rule_versions rv on rv.id = pin.tax_rule_version_id
    where pin.calculation_definition_version_id = new.id
      and rv.status is distinct from 'active'
  ) then
    raise exception
      'tax_calculation_definition_versions cannot activate while a rule pin points at a non-active tax_rule_version';
  end if;

  return new;
end;
$$;

comment on function public.tax_calculation_definition_versions_guard_publication() is
  'K4D structural publication: if rule pins exist, each referenced tax_rule_version must be active. Does not require any rule pin. Does not parse expression_json.';

drop trigger if exists tax_calculation_definition_versions_publication_guard
  on public.tax_calculation_definition_versions;
create trigger tax_calculation_definition_versions_publication_guard
  before update on public.tax_calculation_definition_versions
  for each row
  when (old.status = 'draft' and new.status = 'active')
  execute function public.tax_calculation_definition_versions_guard_publication();

-- ==================================================
-- 5) tax_calculation_runs — immutable advisory snapshots
-- ==================================================

create table if not exists public.tax_calculation_runs (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null,
  as_of date not null,
  currency text not null,
  calculation_definition_id uuid not null,
  calculation_definition_version_id uuid not null,
  definition_checksum text not null,
  expression_checksum text not null,
  engine_dialect text not null,
  engine_dialect_version text not null,
  context_checksum text not null,
  input_checksum text not null,
  result_checksum text not null,
  execution_checksum text not null,
  status text not null check (status in ('calculated', 'blocked')),
  facts_json jsonb not null,
  expression_json jsonb not null,
  default_rounding_json jsonb null,
  result_json jsonb null,
  blocking_json jsonb not null,
  missing_inputs_json jsonb not null,
  trace_json jsonb not null,
  created_at timestamptz not null default now(),
  check (btrim(currency) <> ''),
  check (btrim(definition_checksum) <> ''),
  check (btrim(expression_checksum) <> ''),
  check (btrim(engine_dialect) <> ''),
  check (btrim(engine_dialect_version) <> ''),
  check (btrim(context_checksum) <> ''),
  check (btrim(input_checksum) <> ''),
  check (btrim(result_checksum) <> ''),
  check (btrim(execution_checksum) <> ''),
  check (jsonb_typeof(facts_json) = 'object'),
  check (jsonb_typeof(expression_json) = 'object'),
  check (default_rounding_json is null or jsonb_typeof(default_rounding_json) = 'object'),
  check (jsonb_typeof(blocking_json) = 'array'),
  check (jsonb_typeof(missing_inputs_json) = 'array'),
  check (jsonb_typeof(trace_json) = 'array'),
  check (
    (status = 'calculated' and result_json is not null and jsonb_typeof(result_json) = 'object')
    or (status = 'blocked' and result_json is null)
  )
);

comment on table public.tax_calculation_runs is
  'K4D immutable advisory calculation history. Not Accounting Base financial truth. No tenant/case scope. Exact-version replay only. created_at is persistence metadata and is not part of execution_checksum. Repeated equivalent runs are allowed.';

comment on column public.tax_calculation_runs.expression_json is
  'Copied published expression for self-contained replay if Country Pack or Tax Knowledge later change.';

comment on column public.tax_calculation_runs.execution_checksum is
  'Backend-computed bind of context_checksum + input_checksum + result_checksum. Not unique.';

alter table public.tax_calculation_runs
  add constraint tax_calculation_runs_definition_country_fk
  foreign key (calculation_definition_id, country_code)
  references public.tax_calculation_definitions (id, country_code)
  on delete restrict;

alter table public.tax_calculation_runs
  add constraint tax_calculation_runs_version_country_fk
  foreign key (calculation_definition_version_id, country_code)
  references public.tax_calculation_definition_versions (id, country_code)
  on delete restrict;

alter table public.tax_calculation_runs
  add constraint tax_calculation_runs_version_definition_fk
  foreign key (calculation_definition_version_id, calculation_definition_id)
  references public.tax_calculation_definition_versions (id, tax_calculation_definition_id)
  on delete restrict;

create unique index if not exists uq_tax_calculation_runs_id_country
  on public.tax_calculation_runs (id, country_code);

create unique index if not exists uq_tax_calculation_runs_id_version
  on public.tax_calculation_runs (id, calculation_definition_version_id);

create index if not exists idx_tax_calculation_runs_version
  on public.tax_calculation_runs (calculation_definition_version_id);

create index if not exists idx_tax_calculation_runs_country
  on public.tax_calculation_runs (country_code);

create index if not exists idx_tax_calculation_runs_status
  on public.tax_calculation_runs (status);

create or replace function public.tax_calculation_runs_guard_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_version public.tax_calculation_definition_versions%rowtype;
begin
  select * into v_version
    from public.tax_calculation_definition_versions
    where id = new.calculation_definition_version_id;
  if not found then
    raise exception 'tax_calculation_runs calculation_definition_version_id not found';
  end if;
  if v_version.country_code is distinct from new.country_code then
    raise exception 'Cross-country tax calculation run binding is forbidden';
  end if;
  if v_version.tax_calculation_definition_id is distinct from new.calculation_definition_id then
    raise exception 'tax_calculation_runs definition id must match the pinned version';
  end if;
  if v_version.status not in ('active', 'retired') then
    raise exception 'tax_calculation_runs may persist only published definition versions';
  end if;
  if v_version.definition_checksum is distinct from new.definition_checksum then
    raise exception 'tax_calculation_runs.definition_checksum must match the published version';
  end if;
  if v_version.expression_checksum is distinct from new.expression_checksum then
    raise exception 'tax_calculation_runs.expression_checksum must match the published version';
  end if;
  if v_version.engine_dialect is distinct from new.engine_dialect
    or v_version.engine_dialect_version is distinct from new.engine_dialect_version
  then
    raise exception 'tax_calculation_runs engine dialect must match the published version';
  end if;
  if v_version.expression_json is distinct from new.expression_json then
    raise exception 'tax_calculation_runs.expression_json must match the published version';
  end if;
  if v_version.default_rounding_json is distinct from new.default_rounding_json then
    raise exception 'tax_calculation_runs.default_rounding_json must match the published version';
  end if;
  return new;
end;
$$;

drop trigger if exists tax_calculation_runs_insert_guard
  on public.tax_calculation_runs;
create trigger tax_calculation_runs_insert_guard
  before insert on public.tax_calculation_runs
  for each row execute function public.tax_calculation_runs_guard_insert();

drop trigger if exists tax_calculation_runs_forbid_update
  on public.tax_calculation_runs;
create trigger tax_calculation_runs_forbid_update
  before update on public.tax_calculation_runs
  for each row execute function public.tax_calculation_forbid_update();

drop trigger if exists tax_calculation_runs_forbid_delete
  on public.tax_calculation_runs;
create trigger tax_calculation_runs_forbid_delete
  before delete on public.tax_calculation_runs
  for each row execute function public.tax_calculation_forbid_delete();

drop trigger if exists tax_calculation_runs_forbid_truncate
  on public.tax_calculation_runs;
create trigger tax_calculation_runs_forbid_truncate
  before truncate on public.tax_calculation_runs
  execute function public.tax_calculation_forbid_truncate();

-- ==================================================
-- 6) tax_calculation_run_rule_pins
-- ==================================================

create table if not exists public.tax_calculation_run_rule_pins (
  id uuid primary key default gen_random_uuid(),
  tax_calculation_run_id uuid not null,
  tax_rule_version_id uuid not null,
  tax_rule_id uuid not null,
  country_code char(2) not null,
  version_no integer not null,
  payload_checksum text not null,
  created_at timestamptz not null default now(),
  check (version_no >= 1),
  check (btrim(payload_checksum) <> '')
);

comment on table public.tax_calculation_run_rule_pins is
  'Exact tax_rule_version pins used by an advisory run. No latest resolution. payload_checksum must match the pinned Tax Knowledge version.';

alter table public.tax_calculation_run_rule_pins
  add constraint tax_calculation_run_rule_pins_run_country_fk
  foreign key (tax_calculation_run_id, country_code)
  references public.tax_calculation_runs (id, country_code)
  on delete restrict;

alter table public.tax_calculation_run_rule_pins
  add constraint tax_calculation_run_rule_pins_rule_country_fk
  foreign key (tax_rule_id, country_code)
  references public.tax_rules (id, country_code)
  on delete restrict;

alter table public.tax_calculation_run_rule_pins
  add constraint tax_calculation_run_rule_pins_version_country_fk
  foreign key (tax_rule_version_id, country_code)
  references public.tax_rule_versions (id, country_code)
  on delete restrict;

alter table public.tax_calculation_run_rule_pins
  add constraint tax_calculation_run_rule_pins_version_rule_fk
  foreign key (tax_rule_version_id, tax_rule_id)
  references public.tax_rule_versions (id, tax_rule_id)
  on delete restrict;

create unique index if not exists uq_tax_calculation_run_rule_pins_pair
  on public.tax_calculation_run_rule_pins (tax_calculation_run_id, tax_rule_version_id);

create index if not exists idx_tax_calculation_run_rule_pins_run
  on public.tax_calculation_run_rule_pins (tax_calculation_run_id);

-- ==================================================
-- 7) tax_calculation_run_legal_value_pins
-- ==================================================

create table if not exists public.tax_calculation_run_legal_value_pins (
  id uuid primary key default gen_random_uuid(),
  tax_calculation_run_id uuid not null,
  legal_value_id uuid not null,
  legal_value_version_id uuid not null,
  country_code char(2) not null,
  value_key text not null,
  type text not null check (
    type in (
      'money',
      'decimal',
      'percentage',
      'integer',
      'boolean',
      'date',
      'enum',
      'string'
    )
  ),
  value jsonb not null,
  currency text null,
  effective_from date null,
  effective_to date null,
  snapshot_checksum text not null,
  created_at timestamptz not null default now(),
  check (btrim(value_key) <> ''),
  check (btrim(snapshot_checksum) <> ''),
  check (
    (type = 'boolean' and jsonb_typeof(value) = 'boolean')
    or (type <> 'boolean' and jsonb_typeof(value) = 'string')
  ),
  check (
    (type = 'money' and currency is not null and btrim(currency) <> '')
    or (type <> 'money' and currency is null)
  ),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

comment on table public.tax_calculation_run_legal_value_pins is
  'Exact K4 typed legal-value snapshot used by a run. Copies type/value/currency for replay without reading Country Pack. snapshot_checksum is backend-computed. Does not store a Country Pack source hash. No latest resolution.';

alter table public.tax_calculation_run_legal_value_pins
  add constraint tax_calculation_run_legal_value_pins_run_country_fk
  foreign key (tax_calculation_run_id, country_code)
  references public.tax_calculation_runs (id, country_code)
  on delete restrict;

alter table public.tax_calculation_run_legal_value_pins
  add constraint tax_calculation_run_legal_value_pins_legal_value_country_fk
  foreign key (legal_value_id, country_code)
  references public.country_legal_values (id, country_code)
  on delete restrict;

alter table public.tax_calculation_run_legal_value_pins
  add constraint tax_calculation_run_legal_value_pins_version_fk
  foreign key (legal_value_version_id)
  references public.country_legal_value_versions (id)
  on delete restrict;

create unique index if not exists uq_tax_calculation_run_legal_value_pins_pair
  on public.tax_calculation_run_legal_value_pins (
    tax_calculation_run_id,
    legal_value_version_id
  );

create unique index if not exists uq_tax_calculation_run_legal_value_pins_identity
  on public.tax_calculation_run_legal_value_pins (
    tax_calculation_run_id,
    legal_value_id
  );

create index if not exists idx_tax_calculation_run_legal_value_pins_run
  on public.tax_calculation_run_legal_value_pins (tax_calculation_run_id);

-- ==================================================
-- 8) tax_calculation_run_basis_pins
-- ==================================================

create table if not exists public.tax_calculation_run_basis_pins (
  id uuid primary key default gen_random_uuid(),
  tax_calculation_run_id uuid not null,
  country_code char(2) not null,
  kind text not null check (kind in ('resolved', 'unresolved')),
  required boolean not null,
  tax_rule_relationship_id uuid null,
  from_tax_rule_version_id uuid null,
  to_tax_rule_version_id uuid null,
  unresolved_legal_reference_id uuid null,
  relationship_intent text null,
  locator_text text null,
  cited_title text null,
  created_at timestamptz not null default now(),
  check (
    (
      kind = 'resolved'
      and tax_rule_relationship_id is not null
      and from_tax_rule_version_id is not null
      and to_tax_rule_version_id is not null
      and unresolved_legal_reference_id is null
      and relationship_intent is null
      and locator_text is null
      and cited_title is null
    )
    or (
      kind = 'unresolved'
      and unresolved_legal_reference_id is not null
      and relationship_intent = 'calculation_basis'
      and tax_rule_relationship_id is null
      and from_tax_rule_version_id is null
      and to_tax_rule_version_id is null
    )
  ),
  check (locator_text is null or btrim(locator_text) <> ''),
  check (cited_title is null or btrim(cited_title) <> '')
);

comment on table public.tax_calculation_run_basis_pins is
  'Exact calculation_basis state used by a run: resolved relationship + from/to versions, or unresolved reference + copied locator. No graph walk and no latest resolution.';

alter table public.tax_calculation_run_basis_pins
  add constraint tax_calculation_run_basis_pins_run_country_fk
  foreign key (tax_calculation_run_id, country_code)
  references public.tax_calculation_runs (id, country_code)
  on delete restrict;

alter table public.tax_calculation_run_basis_pins
  add constraint tax_calculation_run_basis_pins_relationship_fk
  foreign key (tax_rule_relationship_id)
  references public.tax_rule_relationships (id)
  on delete restrict;

alter table public.tax_calculation_run_basis_pins
  add constraint tax_calculation_run_basis_pins_from_version_fk
  foreign key (from_tax_rule_version_id, country_code)
  references public.tax_rule_versions (id, country_code)
  on delete restrict;

alter table public.tax_calculation_run_basis_pins
  add constraint tax_calculation_run_basis_pins_to_version_fk
  foreign key (to_tax_rule_version_id, country_code)
  references public.tax_rule_versions (id, country_code)
  on delete restrict;

alter table public.tax_calculation_run_basis_pins
  add constraint tax_calculation_run_basis_pins_unresolved_fk
  foreign key (unresolved_legal_reference_id)
  references public.tax_rule_unresolved_legal_references (id)
  on delete restrict;

create unique index if not exists uq_tax_calculation_run_basis_pins_resolved
  on public.tax_calculation_run_basis_pins (tax_calculation_run_id, tax_rule_relationship_id)
  where tax_rule_relationship_id is not null;

create unique index if not exists uq_tax_calculation_run_basis_pins_unresolved
  on public.tax_calculation_run_basis_pins (tax_calculation_run_id, unresolved_legal_reference_id)
  where unresolved_legal_reference_id is not null;

create index if not exists idx_tax_calculation_run_basis_pins_run
  on public.tax_calculation_run_basis_pins (tax_calculation_run_id);

create or replace function public.tax_calculation_run_child_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  run_country char(2);
  rv public.tax_rule_versions%rowtype;
  lv_country char(2);
  lv_key text;
  ver_legal_value_id uuid;
  rel public.tax_rule_relationships%rowtype;
  unresolved_country char(2);
  unresolved_intent text;
begin
  select r.country_code into run_country
    from public.tax_calculation_runs r
    where r.id = new.tax_calculation_run_id;
  if run_country is distinct from new.country_code then
    raise exception 'Cross-country tax calculation run child binding is forbidden';
  end if;

  if tg_table_name = 'tax_calculation_run_rule_pins' then
    select * into rv
      from public.tax_rule_versions
      where id = new.tax_rule_version_id;
    if not found then
      raise exception 'tax_calculation_run_rule_pins tax_rule_version_id not found';
    end if;
    if rv.country_code is distinct from new.country_code then
      raise exception 'Cross-country tax calculation run rule pin is forbidden';
    end if;
    if rv.tax_rule_id is distinct from new.tax_rule_id then
      raise exception 'tax_calculation_run_rule_pins tax_rule_id must match the pinned version';
    end if;
    if rv.version_no is distinct from new.version_no then
      raise exception 'tax_calculation_run_rule_pins.version_no must match the pinned version';
    end if;
    if rv.payload_checksum is distinct from new.payload_checksum then
      raise exception
        'tax_calculation_run_rule_pins.payload_checksum must match the pinned tax_rule_version';
    end if;
  elsif tg_table_name = 'tax_calculation_run_legal_value_pins' then
    select lv.country_code, lv.value_key
      into lv_country, lv_key
      from public.country_legal_values lv
      where lv.id = new.legal_value_id;
    if lv_country is distinct from new.country_code then
      raise exception 'Cross-country tax calculation run legal-value pin is forbidden';
    end if;
    if lv_key is distinct from new.value_key then
      raise exception
        'tax_calculation_run_legal_value_pins.value_key must match country_legal_values.value_key';
    end if;
    select v.legal_value_id
      into ver_legal_value_id
      from public.country_legal_value_versions v
      where v.id = new.legal_value_version_id;
    if ver_legal_value_id is distinct from new.legal_value_id then
      raise exception
        'tax_calculation_run_legal_value_pins.legal_value_version_id must belong to legal_value_id';
    end if;
  elsif tg_table_name = 'tax_calculation_run_basis_pins' then
    if new.kind = 'resolved' then
      select * into rel
        from public.tax_rule_relationships
        where id = new.tax_rule_relationship_id;
      if not found then
        raise exception 'tax_calculation_run_basis_pins relationship not found';
      end if;
      if rel.country_code is distinct from new.country_code
        or rel.from_tax_rule_version_id is distinct from new.from_tax_rule_version_id
        or rel.to_tax_rule_version_id is distinct from new.to_tax_rule_version_id
      then
        raise exception
          'tax_calculation_run_basis_pins resolved edge must match the exact tax_rule_relationship';
      end if;
      if rel.relationship_type is distinct from 'calculation_basis' then
        raise exception
          'tax_calculation_run_basis_pins resolved relationship_type must be calculation_basis';
      end if;
    else
      select u.country_code, u.relationship_intent
        into unresolved_country, unresolved_intent
        from public.tax_rule_unresolved_legal_references u
        where u.id = new.unresolved_legal_reference_id;
      if unresolved_country is distinct from new.country_code then
        raise exception 'Cross-country tax calculation run unresolved basis pin is forbidden';
      end if;
      if unresolved_intent is distinct from 'calculation_basis' then
        raise exception
          'tax_calculation_run_basis_pins unresolved relationship_intent must be calculation_basis';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tax_calculation_run_rule_pins_guard
  on public.tax_calculation_run_rule_pins;
create trigger tax_calculation_run_rule_pins_guard
  before insert on public.tax_calculation_run_rule_pins
  for each row execute function public.tax_calculation_run_child_guard();

drop trigger if exists tax_calculation_run_legal_value_pins_guard
  on public.tax_calculation_run_legal_value_pins;
create trigger tax_calculation_run_legal_value_pins_guard
  before insert on public.tax_calculation_run_legal_value_pins
  for each row execute function public.tax_calculation_run_child_guard();

drop trigger if exists tax_calculation_run_basis_pins_guard
  on public.tax_calculation_run_basis_pins;
create trigger tax_calculation_run_basis_pins_guard
  before insert on public.tax_calculation_run_basis_pins
  for each row execute function public.tax_calculation_run_child_guard();

drop trigger if exists tax_calculation_run_rule_pins_forbid_update
  on public.tax_calculation_run_rule_pins;
create trigger tax_calculation_run_rule_pins_forbid_update
  before update on public.tax_calculation_run_rule_pins
  for each row execute function public.tax_calculation_forbid_update();

drop trigger if exists tax_calculation_run_legal_value_pins_forbid_update
  on public.tax_calculation_run_legal_value_pins;
create trigger tax_calculation_run_legal_value_pins_forbid_update
  before update on public.tax_calculation_run_legal_value_pins
  for each row execute function public.tax_calculation_forbid_update();

drop trigger if exists tax_calculation_run_basis_pins_forbid_update
  on public.tax_calculation_run_basis_pins;
create trigger tax_calculation_run_basis_pins_forbid_update
  before update on public.tax_calculation_run_basis_pins
  for each row execute function public.tax_calculation_forbid_update();

drop trigger if exists tax_calculation_run_rule_pins_forbid_delete
  on public.tax_calculation_run_rule_pins;
create trigger tax_calculation_run_rule_pins_forbid_delete
  before delete on public.tax_calculation_run_rule_pins
  for each row execute function public.tax_calculation_forbid_delete();

drop trigger if exists tax_calculation_run_legal_value_pins_forbid_delete
  on public.tax_calculation_run_legal_value_pins;
create trigger tax_calculation_run_legal_value_pins_forbid_delete
  before delete on public.tax_calculation_run_legal_value_pins
  for each row execute function public.tax_calculation_forbid_delete();

drop trigger if exists tax_calculation_run_basis_pins_forbid_delete
  on public.tax_calculation_run_basis_pins;
create trigger tax_calculation_run_basis_pins_forbid_delete
  before delete on public.tax_calculation_run_basis_pins
  for each row execute function public.tax_calculation_forbid_delete();

drop trigger if exists tax_calculation_run_rule_pins_forbid_truncate
  on public.tax_calculation_run_rule_pins;
create trigger tax_calculation_run_rule_pins_forbid_truncate
  before truncate on public.tax_calculation_run_rule_pins
  execute function public.tax_calculation_forbid_truncate();

drop trigger if exists tax_calculation_run_legal_value_pins_forbid_truncate
  on public.tax_calculation_run_legal_value_pins;
create trigger tax_calculation_run_legal_value_pins_forbid_truncate
  before truncate on public.tax_calculation_run_legal_value_pins
  execute function public.tax_calculation_forbid_truncate();

drop trigger if exists tax_calculation_run_basis_pins_forbid_truncate
  on public.tax_calculation_run_basis_pins;
create trigger tax_calculation_run_basis_pins_forbid_truncate
  before truncate on public.tax_calculation_run_basis_pins
  execute function public.tax_calculation_forbid_truncate();

-- ==================================================
-- 9) Atomic persist RPC — SECURITY INVOKER, persistence integrity only
-- ==================================================

create or replace function public.tax_calculation_persist_run(
  p_run jsonb,
  p_rule_pins jsonb default '[]'::jsonb,
  p_legal_value_pins jsonb default '[]'::jsonb,
  p_basis_pins jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_run_id uuid;
  v_row jsonb;
  v_version public.tax_calculation_definition_versions%rowtype;
  v_definition_id uuid;
  v_version_id uuid;
  v_status text;
begin
  -- One transaction: any exception rolls back the run and all child pins.
  -- Does not evaluate expressions, resolve latest versions, call TRE, or compute checksums.
  if p_run is null or jsonb_typeof(p_run) is distinct from 'object' then
    raise exception 'tax_calculation_persist_run p_run must be a JSON object';
  end if;
  if p_run ? 'id' and nullif(btrim(p_run ->> 'id'), '') is not null then
    raise exception 'tax_calculation_persist_run does not accept a client-supplied id';
  end if;
  if p_rule_pins is null or jsonb_typeof(p_rule_pins) is distinct from 'array' then
    raise exception 'tax_calculation_persist_run p_rule_pins must be a JSON array';
  end if;
  if p_legal_value_pins is null or jsonb_typeof(p_legal_value_pins) is distinct from 'array' then
    raise exception 'tax_calculation_persist_run p_legal_value_pins must be a JSON array';
  end if;
  if p_basis_pins is null or jsonb_typeof(p_basis_pins) is distinct from 'array' then
    raise exception 'tax_calculation_persist_run p_basis_pins must be a JSON array';
  end if;

  v_definition_id := (p_run ->> 'calculation_definition_id')::uuid;
  v_version_id := (p_run ->> 'calculation_definition_version_id')::uuid;
  select * into v_version
    from public.tax_calculation_definition_versions
    where id = v_version_id;
  if not found then
    raise exception 'tax_calculation_persist_run calculation_definition_version_id not found';
  end if;
  if v_version.tax_calculation_definition_id is distinct from v_definition_id then
    raise exception 'tax_calculation_persist_run version must belong to calculation_definition_id';
  end if;
  if p_run ? 'country_code'
    and (p_run ->> 'country_code') is distinct from v_version.country_code
  then
    raise exception 'tax_calculation_persist_run country_code must match the published version';
  end if;

  v_status := p_run ->> 'status';

  insert into public.tax_calculation_runs (
    id,
    country_code,
    as_of,
    currency,
    calculation_definition_id,
    calculation_definition_version_id,
    definition_checksum,
    expression_checksum,
    engine_dialect,
    engine_dialect_version,
    context_checksum,
    input_checksum,
    result_checksum,
    execution_checksum,
    status,
    facts_json,
    expression_json,
    default_rounding_json,
    result_json,
    blocking_json,
    missing_inputs_json,
    trace_json
  )
  values (
    gen_random_uuid(),
    v_version.country_code,
    (p_run ->> 'as_of')::date,
    p_run ->> 'currency',
    v_version.tax_calculation_definition_id,
    v_version.id,
    v_version.definition_checksum,
    v_version.expression_checksum,
    v_version.engine_dialect,
    v_version.engine_dialect_version,
    p_run ->> 'context_checksum',
    p_run ->> 'input_checksum',
    p_run ->> 'result_checksum',
    p_run ->> 'execution_checksum',
    v_status,
    coalesce(p_run -> 'facts_json', '{}'::jsonb),
    v_version.expression_json,
    v_version.default_rounding_json,
    p_run -> 'result_json',
    coalesce(p_run -> 'blocking_json', '[]'::jsonb),
    coalesce(p_run -> 'missing_inputs_json', '[]'::jsonb),
    coalesce(p_run -> 'trace_json', '[]'::jsonb)
  )
  returning id into v_run_id;

  for v_row in select value from jsonb_array_elements(p_rule_pins)
  loop
    insert into public.tax_calculation_run_rule_pins (
      tax_calculation_run_id,
      tax_rule_version_id,
      tax_rule_id,
      country_code,
      version_no,
      payload_checksum
    )
    values (
      v_run_id,
      (v_row ->> 'tax_rule_version_id')::uuid,
      (v_row ->> 'tax_rule_id')::uuid,
      v_row ->> 'country_code',
      (v_row ->> 'version_no')::integer,
      v_row ->> 'payload_checksum'
    );
  end loop;

  for v_row in select value from jsonb_array_elements(p_legal_value_pins)
  loop
    insert into public.tax_calculation_run_legal_value_pins (
      tax_calculation_run_id,
      legal_value_id,
      legal_value_version_id,
      country_code,
      value_key,
      type,
      value,
      currency,
      effective_from,
      effective_to,
      snapshot_checksum
    )
    values (
      v_run_id,
      (v_row ->> 'legal_value_id')::uuid,
      (v_row ->> 'legal_value_version_id')::uuid,
      v_row ->> 'country_code',
      v_row ->> 'value_key',
      v_row ->> 'type',
      v_row -> 'value',
      v_row ->> 'currency',
      nullif(v_row ->> 'effective_from', '')::date,
      nullif(v_row ->> 'effective_to', '')::date,
      v_row ->> 'snapshot_checksum'
    );
  end loop;

  for v_row in select value from jsonb_array_elements(p_basis_pins)
  loop
    insert into public.tax_calculation_run_basis_pins (
      tax_calculation_run_id,
      country_code,
      kind,
      required,
      tax_rule_relationship_id,
      from_tax_rule_version_id,
      to_tax_rule_version_id,
      unresolved_legal_reference_id,
      relationship_intent,
      locator_text,
      cited_title
    )
    values (
      v_run_id,
      v_row ->> 'country_code',
      v_row ->> 'kind',
      coalesce((v_row ->> 'required')::boolean, false),
      nullif(v_row ->> 'tax_rule_relationship_id', '')::uuid,
      nullif(v_row ->> 'from_tax_rule_version_id', '')::uuid,
      nullif(v_row ->> 'to_tax_rule_version_id', '')::uuid,
      nullif(v_row ->> 'unresolved_legal_reference_id', '')::uuid,
      nullif(v_row ->> 'relationship_intent', ''),
      nullif(v_row ->> 'locator_text', ''),
      nullif(v_row ->> 'cited_title', '')
    );
  end loop;

  if exists (
    select 1
    from public.tax_calculation_definition_rule_pins d
    where d.calculation_definition_version_id = v_version.id
      and not exists (
        select 1
        from public.tax_calculation_run_rule_pins r
        where r.tax_calculation_run_id = v_run_id
          and r.tax_rule_version_id = d.tax_rule_version_id
      )
  ) then
    raise exception
      'tax_calculation_persist_run is missing a declared definition rule pin';
  end if;

  if exists (
    select 1
    from public.tax_calculation_run_rule_pins r
    where r.tax_calculation_run_id = v_run_id
      and not exists (
        select 1
        from public.tax_calculation_definition_rule_pins d
        where d.calculation_definition_version_id = v_version.id
          and d.tax_rule_version_id = r.tax_rule_version_id
      )
  ) then
    raise exception
      'tax_calculation_persist_run does not accept undeclared rule pins';
  end if;

  if exists (
    select 1
    from public.tax_calculation_run_legal_value_pins r
    where r.tax_calculation_run_id = v_run_id
      and not exists (
        select 1
        from public.tax_calculation_definition_legal_value_requirements d
        where d.calculation_definition_version_id = v_version.id
          and d.legal_value_id = r.legal_value_id
      )
  ) then
    raise exception
      'tax_calculation_persist_run does not accept undeclared legal-value identities';
  end if;

  if v_status = 'calculated'
    and exists (
      select 1
      from public.tax_calculation_definition_legal_value_requirements d
      where d.calculation_definition_version_id = v_version.id
        and d.required is true
        and not exists (
          select 1
          from public.tax_calculation_run_legal_value_pins r
          where r.tax_calculation_run_id = v_run_id
            and r.legal_value_id = d.legal_value_id
        )
    )
  then
    raise exception
      'tax_calculation_persist_run calculated run is missing a required legal-value pin';
  end if;

  return jsonb_build_object(
    'ok', true,
    'tax_calculation_run_id', v_run_id
  );
end;
$$;

comment on function public.tax_calculation_persist_run(jsonb, jsonb, jsonb, jsonb) is
  'K4D atomic advisory-run persist. SECURITY INVOKER. Copies published expression/rounding/dialect/checksums from the definition version. Generates run id. Requires exact declared rule pins; required legal-value pins on calculated runs; blocked runs may omit a missing required legal value. Does not evaluate, resolve latest, call TRE, or invent checksums. service_role only.';

revoke all on function public.tax_calculation_persist_run(jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function public.tax_calculation_persist_run(jsonb, jsonb, jsonb, jsonb) from anon, authenticated;
grant execute on function public.tax_calculation_persist_run(jsonb, jsonb, jsonb, jsonb) to service_role;

-- ==================================================
-- 10) RLS + privileges
-- ==================================================

alter table public.tax_calculation_definitions enable row level security;
alter table public.tax_calculation_definitions force row level security;
alter table public.tax_calculation_definition_versions enable row level security;
alter table public.tax_calculation_definition_versions force row level security;
alter table public.tax_calculation_definition_rule_pins enable row level security;
alter table public.tax_calculation_definition_rule_pins force row level security;
alter table public.tax_calculation_definition_legal_value_requirements enable row level security;
alter table public.tax_calculation_definition_legal_value_requirements force row level security;
alter table public.tax_calculation_runs enable row level security;
alter table public.tax_calculation_runs force row level security;
alter table public.tax_calculation_run_rule_pins enable row level security;
alter table public.tax_calculation_run_rule_pins force row level security;
alter table public.tax_calculation_run_legal_value_pins enable row level security;
alter table public.tax_calculation_run_legal_value_pins force row level security;
alter table public.tax_calculation_run_basis_pins enable row level security;
alter table public.tax_calculation_run_basis_pins force row level security;

revoke all on table public.tax_calculation_definitions from public, anon, authenticated;
revoke all on table public.tax_calculation_definition_versions from public, anon, authenticated;
revoke all on table public.tax_calculation_definition_rule_pins from public, anon, authenticated;
revoke all on table public.tax_calculation_definition_legal_value_requirements from public, anon, authenticated;
revoke all on table public.tax_calculation_runs from public, anon, authenticated;
revoke all on table public.tax_calculation_run_rule_pins from public, anon, authenticated;
revoke all on table public.tax_calculation_run_legal_value_pins from public, anon, authenticated;
revoke all on table public.tax_calculation_run_basis_pins from public, anon, authenticated;

grant select, insert, update, delete on table
  public.tax_calculation_definitions,
  public.tax_calculation_definition_versions,
  public.tax_calculation_definition_rule_pins,
  public.tax_calculation_definition_legal_value_requirements
  to service_role;

grant select, insert on table
  public.tax_calculation_runs,
  public.tax_calculation_run_rule_pins,
  public.tax_calculation_run_legal_value_pins,
  public.tax_calculation_run_basis_pins
  to service_role;
