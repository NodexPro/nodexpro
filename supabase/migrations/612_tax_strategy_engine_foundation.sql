-- TAX-E2 — Tax Strategy Engine persistence foundation.
-- Tax Brain reserved migration range: 600–699.
-- Scope: strategy identity/versions, exclusive-group identity, exact rule/calculation
--        pins, publication guards, and one SECURITY DEFINER supersession RPC.
-- Does not alter migrations 600–611, 086, or 163.
-- No commands, no aggregates, no UI, no tenant/case tables, no Accounting Base writes.
--
-- Ownership:
--   Strategy Engine owns canonical professional tax strategies.
--   Tax Knowledge owns legal rules / sources / relationships.
--   Calculation Engine owns calculation definitions and advisory runs.
--   Country Pack owns statutory legal values.
--   Accounting Base remains financial truth.
--   Work Engine remains work orchestration.
--
-- No organization_id / client_id / case_id.
-- No latest-version resolution.
-- Backend will compute strategy_checksum later. SQL stores and freezes it; it does
-- not hash authored content. effective_from / effective_to are publication windows
-- and are excluded from strategy_checksum.

create extension if not exists btree_gist;

-- ==================================================
-- Shared helpers / guards
-- ==================================================

create or replace function public.tax_strategy_forbid_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Hard delete is forbidden for tax strategy table %. Use retirement on published versions.', tg_table_name;
end;
$$;

create or replace function public.tax_strategy_forbid_truncate()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'TRUNCATE is forbidden for tax strategy table %.', tg_table_name;
end;
$$;

create or replace function public.tax_strategy_json_is_string_array(p jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select
    p is null
    or (
      jsonb_typeof(p) = 'array'
      and coalesce((
        select bool_and(jsonb_typeof(elem) = 'string')
        from jsonb_array_elements(p) elem
      ), true)
    );
$$;

create or replace function public.tax_strategy_authored_metadata_is_canonical(p jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select
    jsonb_typeof(p) = 'object'
    and (
      p - array[
        'explanation',
        'benefits',
        'risks',
        'constraints',
        'costs_tradeoffs',
        'category',
        'domain',
        'tags'
      ]
    ) = '{}'::jsonb
    and (not (p ? 'explanation') or jsonb_typeof(p -> 'explanation') = 'string')
    and public.tax_strategy_json_is_string_array(p -> 'benefits')
    and public.tax_strategy_json_is_string_array(p -> 'risks')
    and public.tax_strategy_json_is_string_array(p -> 'constraints')
    and public.tax_strategy_json_is_string_array(p -> 'costs_tradeoffs')
    and (
      not (p ? 'category')
      or p -> 'category' = 'null'::jsonb
      or jsonb_typeof(p -> 'category') = 'string'
    )
    and (
      not (p ? 'domain')
      or p -> 'domain' = 'null'::jsonb
      or jsonb_typeof(p -> 'domain') = 'string'
    )
    and public.tax_strategy_json_is_string_array(p -> 'tags');
$$;

comment on function public.tax_strategy_authored_metadata_is_canonical(jsonb) is
  'E2 closed authored metadata: explanation, benefits, risks, constraints, costs_tradeoffs, category, domain, tags. No E1 status/findings, ranking, availability, K4 results, AI output, or financial actuals.';

-- ==================================================
-- 1) tax_strategies — stable identity (no lifecycle, no professional title)
-- ==================================================

create table if not exists public.tax_strategies (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null references public.countries(code) on delete restrict,
  strategy_code text not null,
  admin_label text null,
  owner_note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(strategy_code) <> ''),
  check (admin_label is null or btrim(admin_label) <> '')
);

comment on table public.tax_strategies is
  'E2 platform-canonical strategy identity. Country-scoped. No organization_id. No lifecycle status — versions own draft/active/retired. No professional title or description.';

comment on column public.tax_strategies.strategy_code is
  'Immutable per-country identity code. Not a professional display title.';

comment on column public.tax_strategies.admin_label is
  'Optional Owner-only administrative catalog nickname. Never the canonical professional strategy name. Excluded from strategy_checksum. Never loaded into E1 as title.';

create unique index if not exists uq_tax_strategies_country_code
  on public.tax_strategies (country_code, strategy_code);

create unique index if not exists uq_tax_strategies_id_country
  on public.tax_strategies (id, country_code);

create index if not exists idx_tax_strategies_country
  on public.tax_strategies (country_code);

create trigger tax_strategies_updated_at
  before update on public.tax_strategies
  for each row execute function public.set_updated_at();

create or replace function public.tax_strategies_protect_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.country_code is distinct from new.country_code then
    raise exception 'tax_strategies.country_code is immutable';
  end if;
  if old.strategy_code is distinct from new.strategy_code then
    raise exception 'tax_strategies.strategy_code is immutable';
  end if;
  if old.created_at is distinct from new.created_at then
    raise exception 'tax_strategies.created_at is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists tax_strategies_identity_guard
  on public.tax_strategies;
create trigger tax_strategies_identity_guard
  before update on public.tax_strategies
  for each row execute function public.tax_strategies_protect_identity();

drop trigger if exists tax_strategies_forbid_delete
  on public.tax_strategies;
create trigger tax_strategies_forbid_delete
  before delete on public.tax_strategies
  for each row execute function public.tax_strategy_forbid_delete();

drop trigger if exists tax_strategies_forbid_truncate
  on public.tax_strategies;
create trigger tax_strategies_forbid_truncate
  before truncate on public.tax_strategies
  execute function public.tax_strategy_forbid_truncate();

-- ==================================================
-- 2) tax_strategy_exclusive_groups — country-scoped group identity
-- ==================================================

create table if not exists public.tax_strategy_exclusive_groups (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null references public.countries(code) on delete restrict,
  group_code text not null,
  title text not null,
  owner_note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(group_code) <> ''),
  check (btrim(title) <> '')
);

comment on table public.tax_strategy_exclusive_groups is
  'E2 explicit exclusive-group identity. Country-scoped. No lifecycle status. Membership is version-scoped on tax_strategy_versions. Never inferred from tax_rule_relationship alternative_to.';

create unique index if not exists uq_tax_strategy_exclusive_groups_country_code
  on public.tax_strategy_exclusive_groups (country_code, group_code);

create unique index if not exists uq_tax_strategy_exclusive_groups_id_country
  on public.tax_strategy_exclusive_groups (id, country_code);

create index if not exists idx_tax_strategy_exclusive_groups_country
  on public.tax_strategy_exclusive_groups (country_code);

create trigger tax_strategy_exclusive_groups_updated_at
  before update on public.tax_strategy_exclusive_groups
  for each row execute function public.set_updated_at();

create or replace function public.tax_strategy_exclusive_groups_protect_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.country_code is distinct from new.country_code then
    raise exception 'tax_strategy_exclusive_groups.country_code is immutable';
  end if;
  if old.group_code is distinct from new.group_code then
    raise exception 'tax_strategy_exclusive_groups.group_code is immutable';
  end if;
  if old.created_at is distinct from new.created_at then
    raise exception 'tax_strategy_exclusive_groups.created_at is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists tax_strategy_exclusive_groups_identity_guard
  on public.tax_strategy_exclusive_groups;
create trigger tax_strategy_exclusive_groups_identity_guard
  before update on public.tax_strategy_exclusive_groups
  for each row execute function public.tax_strategy_exclusive_groups_protect_identity();

drop trigger if exists tax_strategy_exclusive_groups_forbid_delete
  on public.tax_strategy_exclusive_groups;
create trigger tax_strategy_exclusive_groups_forbid_delete
  before delete on public.tax_strategy_exclusive_groups
  for each row execute function public.tax_strategy_forbid_delete();

drop trigger if exists tax_strategy_exclusive_groups_forbid_truncate
  on public.tax_strategy_exclusive_groups;
create trigger tax_strategy_exclusive_groups_forbid_truncate
  before truncate on public.tax_strategy_exclusive_groups
  execute function public.tax_strategy_forbid_truncate();

-- ==================================================
-- 3) tax_strategy_versions
-- ==================================================

create table if not exists public.tax_strategy_versions (
  id uuid primary key default gen_random_uuid(),
  tax_strategy_id uuid not null,
  country_code char(2) not null,
  version_no integer not null,
  status text not null check (status in ('draft', 'active', 'retired')),
  effective_from date not null,
  effective_to date null,
  title text not null,
  requires_professional_judgment boolean not null default false,
  exclusive_group_id uuid null,
  authored_metadata_json jsonb not null default '{}'::jsonb,
  strategy_checksum text not null,
  supersedes_version_id uuid null,
  superseded_by_version_id uuid null,
  activated_at timestamptz null,
  retired_at timestamptz null,
  retired_reason text null,
  created_at timestamptz not null default now(),
  check (version_no >= 1),
  check (btrim(title) <> ''),
  check (btrim(strategy_checksum) <> ''),
  check (public.tax_strategy_authored_metadata_is_canonical(authored_metadata_json)),
  check (effective_to is null or effective_to >= effective_from),
  check (supersedes_version_id is null or supersedes_version_id <> id),
  check (superseded_by_version_id is null or superseded_by_version_id <> id)
);

comment on table public.tax_strategy_versions is
  'E2 versioned canonical professional strategy. Draft mutable; active/retired authored content immutable. Exact-version historical identity. Backend computes strategy_checksum; SQL does not hash authored content.';

comment on column public.tax_strategy_versions.title is
  'Sole canonical professional strategy name. Required and non-blank. Loaded later into E1 TaxStrategyVersionInput.title. Identity admin_label is never this name.';

comment on column public.tax_strategy_versions.authored_metadata_json is
  'Closed canonical authored metadata only (explanation, benefits, risks, constraints, costs_tradeoffs, category, domain, tags). No E1 status/findings, ranking, availability, K4 results, AI output, or financial actuals.';

comment on column public.tax_strategy_versions.strategy_checksum is
  'Backend-computed SHA-256 of canonical authored CONTENT only: country_code, version title, requires_professional_judgment, exclusive_group_id, sorted required/prohibited tax_rule_version_ids, sorted calculation_definition_version_ids, canonical authored_metadata_json. Excludes effective_from, effective_to, status, version_no, created_at, activated_at, retired_at, retired_reason, actor/audit ids, admin_label, owner_note, strategy/version row ids, and E1 computed output. SQL stores/freezes it and does not compute or digest it.';

comment on column public.tax_strategy_versions.effective_from is
  'Publication window start for later as_of selection. Excluded from strategy_checksum. Frozen after leaving draft. Replay pins this version id.';

comment on column public.tax_strategy_versions.effective_to is
  'Publication window end. Excluded from strategy_checksum. Nullable while active; may be narrowed while active; frozen after retirement. Close-out must not mutate strategy_checksum.';

comment on column public.tax_strategy_versions.exclusive_group_id is
  'Optional exact exclusive-group identity. Version-scoped. Same-country only. Never inferred from alternative_to.';

alter table public.tax_strategy_versions
  add constraint tax_strategy_versions_strategy_country_fk
  foreign key (tax_strategy_id, country_code)
  references public.tax_strategies (id, country_code)
  on delete restrict;

alter table public.tax_strategy_versions
  add constraint tax_strategy_versions_exclusive_group_country_fk
  foreign key (exclusive_group_id, country_code)
  references public.tax_strategy_exclusive_groups (id, country_code)
  on delete restrict;

create unique index if not exists uq_tax_strategy_versions_strategy_no
  on public.tax_strategy_versions (tax_strategy_id, version_no);

create unique index if not exists uq_tax_strategy_versions_id_country
  on public.tax_strategy_versions (id, country_code);

create unique index if not exists uq_tax_strategy_versions_id_strategy
  on public.tax_strategy_versions (id, tax_strategy_id);

alter table public.tax_strategy_versions
  add constraint tax_strategy_versions_supersedes_same_strategy_fk
  foreign key (supersedes_version_id, tax_strategy_id)
  references public.tax_strategy_versions (id, tax_strategy_id)
  on delete restrict;

alter table public.tax_strategy_versions
  add constraint tax_strategy_versions_superseded_by_same_strategy_fk
  foreign key (superseded_by_version_id, tax_strategy_id)
  references public.tax_strategy_versions (id, tax_strategy_id)
  on delete restrict;

create index if not exists idx_tax_strategy_versions_strategy
  on public.tax_strategy_versions (tax_strategy_id);

create index if not exists idx_tax_strategy_versions_country
  on public.tax_strategy_versions (country_code);

create index if not exists idx_tax_strategy_versions_status
  on public.tax_strategy_versions (status);

create index if not exists idx_tax_strategy_versions_exclusive_group
  on public.tax_strategy_versions (exclusive_group_id);

create index if not exists idx_tax_strategy_versions_effective
  on public.tax_strategy_versions (tax_strategy_id, effective_from, effective_to);

alter table public.tax_strategy_versions
  add constraint tax_strategy_versions_no_active_overlap
  exclude using gist (
    tax_strategy_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  )
  where (status = 'active');

create or replace function public.tax_strategy_versions_guard_country()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (
    select s.country_code
    from public.tax_strategies s
    where s.id = new.tax_strategy_id
  ) is distinct from new.country_code then
    raise exception 'Cross-country tax strategy version binding is forbidden';
  end if;

  if new.exclusive_group_id is not null
    and (
      select g.country_code
      from public.tax_strategy_exclusive_groups g
      where g.id = new.exclusive_group_id
    ) is distinct from new.country_code
  then
    raise exception 'Cross-country tax strategy exclusive group binding is forbidden';
  end if;

  return new;
end;
$$;

drop trigger if exists tax_strategy_versions_country_guard
  on public.tax_strategy_versions;
create trigger tax_strategy_versions_country_guard
  before insert or update on public.tax_strategy_versions
  for each row execute function public.tax_strategy_versions_guard_country();

create or replace function public.tax_strategy_versions_guard_monotonic_version_no()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  next_no integer;
begin
  select coalesce(max(v.version_no), 0) + 1
    into next_no
    from public.tax_strategy_versions v
    where v.tax_strategy_id = new.tax_strategy_id;

  if new.version_no <> next_no then
    raise exception
      'tax_strategy_versions.version_no must be monotonic per strategy (expected %)',
      next_no;
  end if;
  return new;
end;
$$;

drop trigger if exists tax_strategy_versions_monotonic_version_no_guard
  on public.tax_strategy_versions;
create trigger tax_strategy_versions_monotonic_version_no_guard
  before insert on public.tax_strategy_versions
  for each row execute function public.tax_strategy_versions_guard_monotonic_version_no();

create or replace function public.tax_strategy_versions_guard_insert_draft_only()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status is distinct from 'draft' then
    raise exception 'tax_strategy_versions must be inserted as draft';
  end if;
  return new;
end;
$$;

drop trigger if exists tax_strategy_versions_insert_draft_only
  on public.tax_strategy_versions;
create trigger tax_strategy_versions_insert_draft_only
  before insert on public.tax_strategy_versions
  for each row execute function public.tax_strategy_versions_guard_insert_draft_only();

create or replace function public.tax_strategy_versions_protect_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.created_at is distinct from new.created_at then
    raise exception 'tax_strategy_versions.created_at is immutable';
  end if;

  if old.status is distinct from new.status then
    if not (
      (old.status = 'draft' and new.status in ('active', 'retired'))
      or (old.status = 'active' and new.status = 'retired')
    ) then
      raise exception
        'Invalid tax_strategy_versions status transition: % → %',
        old.status,
        new.status;
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
      old.tax_strategy_id is distinct from new.tax_strategy_id
      or old.country_code is distinct from new.country_code
      or old.version_no is distinct from new.version_no
      or old.title is distinct from new.title
      or old.requires_professional_judgment is distinct from new.requires_professional_judgment
      or old.exclusive_group_id is distinct from new.exclusive_group_id
      or old.authored_metadata_json is distinct from new.authored_metadata_json
      or old.strategy_checksum is distinct from new.strategy_checksum
      or old.effective_from is distinct from new.effective_from
      or old.supersedes_version_id is distinct from new.supersedes_version_id
      or old.activated_at is distinct from new.activated_at
    ) then
      raise exception
        'tax_strategy_versions authored fields are immutable after leaving draft';
    end if;

    if old.status = 'retired' then
      if old.effective_to is distinct from new.effective_to then
        raise exception 'tax_strategy_versions.effective_to is frozen after retirement';
      end if;
    else
      if old.effective_to is not null then
        if new.effective_to is null then
          raise exception
            'tax_strategy_versions.effective_to cannot be cleared after close-out';
        end if;
        if new.effective_to > old.effective_to then
          raise exception
            'tax_strategy_versions.effective_to cannot be extended after leaving draft';
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tax_strategy_versions_immutability_guard
  on public.tax_strategy_versions;
create trigger tax_strategy_versions_immutability_guard
  before update on public.tax_strategy_versions
  for each row execute function public.tax_strategy_versions_protect_immutability();

create or replace function public.tax_strategy_versions_guard_supersession_cycle()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  cursor_id uuid;
  seen integer;
begin
  if new.supersedes_version_id is not null then
    cursor_id := new.supersedes_version_id;
    seen := 0;
    while cursor_id is not null loop
      seen := seen + 1;
      if seen > 1000 then
        raise exception 'tax_strategy_versions supersession chain too long';
      end if;
      if cursor_id = new.id then
        raise exception 'Circular tax strategy supersession lineage is forbidden';
      end if;
      select v.supersedes_version_id
        into cursor_id
        from public.tax_strategy_versions v
        where v.id = cursor_id;
    end loop;
  end if;

  if new.superseded_by_version_id is not null then
    cursor_id := new.superseded_by_version_id;
    seen := 0;
    while cursor_id is not null loop
      seen := seen + 1;
      if seen > 1000 then
        raise exception 'tax_strategy_versions superseded_by chain too long';
      end if;
      if cursor_id = new.id then
        raise exception 'Circular tax strategy superseded_by lineage is forbidden';
      end if;
      select v.superseded_by_version_id
        into cursor_id
        from public.tax_strategy_versions v
        where v.id = cursor_id;
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists tax_strategy_versions_supersession_cycle_guard
  on public.tax_strategy_versions;
create trigger tax_strategy_versions_supersession_cycle_guard
  before insert or update on public.tax_strategy_versions
  for each row execute function public.tax_strategy_versions_guard_supersession_cycle();

drop trigger if exists tax_strategy_versions_forbid_delete
  on public.tax_strategy_versions;
create trigger tax_strategy_versions_forbid_delete
  before delete on public.tax_strategy_versions
  for each row execute function public.tax_strategy_forbid_delete();

drop trigger if exists tax_strategy_versions_forbid_truncate
  on public.tax_strategy_versions;
create trigger tax_strategy_versions_forbid_truncate
  before truncate on public.tax_strategy_versions
  execute function public.tax_strategy_forbid_truncate();

-- ==================================================
-- 4) tax_strategy_version_rule_pins
-- ==================================================

create table if not exists public.tax_strategy_version_rule_pins (
  id uuid primary key default gen_random_uuid(),
  tax_strategy_version_id uuid not null,
  country_code char(2) not null,
  tax_rule_version_id uuid not null,
  pin_role text not null check (pin_role in ('required', 'prohibited')),
  created_at timestamptz not null default now()
);

comment on table public.tax_strategy_version_rule_pins is
  'E2 exact tax_rule_version pins. pin_role required|prohibited only. Same-country only. No rule payload or provenance copy. INSERT/DELETE allowed only while the parent version is draft (unpin). Published child DELETE is forbidden. tax_strategy_forbid_delete is not attached here. Does not require any rule pin.';

alter table public.tax_strategy_version_rule_pins
  add constraint tax_strategy_version_rule_pins_version_country_fk
  foreign key (tax_strategy_version_id, country_code)
  references public.tax_strategy_versions (id, country_code)
  on delete restrict;

alter table public.tax_strategy_version_rule_pins
  add constraint tax_strategy_version_rule_pins_rule_version_country_fk
  foreign key (tax_rule_version_id, country_code)
  references public.tax_rule_versions (id, country_code)
  on delete restrict;

create unique index if not exists uq_tax_strategy_version_rule_pins_pair
  on public.tax_strategy_version_rule_pins (
    tax_strategy_version_id,
    tax_rule_version_id
  );

create index if not exists idx_tax_strategy_version_rule_pins_version
  on public.tax_strategy_version_rule_pins (tax_strategy_version_id);

create index if not exists idx_tax_strategy_version_rule_pins_country
  on public.tax_strategy_version_rule_pins (country_code);

create index if not exists idx_tax_strategy_version_rule_pins_role
  on public.tax_strategy_version_rule_pins (pin_role);

-- ==================================================
-- 5) tax_strategy_version_calculation_pins
-- ==================================================

create table if not exists public.tax_strategy_version_calculation_pins (
  id uuid primary key default gen_random_uuid(),
  tax_strategy_version_id uuid not null,
  country_code char(2) not null,
  calculation_definition_version_id uuid not null,
  created_at timestamptz not null default now()
);

comment on table public.tax_strategy_version_calculation_pins is
  'E2 optional exact tax_calculation_definition_version pins. Zero or more. Same-country only. No AST, rounding, formula, run, or legal-value copy. INSERT/DELETE allowed only while the parent version is draft (unpin). Published child DELETE is forbidden. Does not require any calculation pin.';

alter table public.tax_strategy_version_calculation_pins
  add constraint tax_strategy_version_calculation_pins_version_country_fk
  foreign key (tax_strategy_version_id, country_code)
  references public.tax_strategy_versions (id, country_code)
  on delete restrict;

alter table public.tax_strategy_version_calculation_pins
  add constraint tax_strategy_version_calculation_pins_calc_version_country_fk
  foreign key (calculation_definition_version_id, country_code)
  references public.tax_calculation_definition_versions (id, country_code)
  on delete restrict;

create unique index if not exists uq_tax_strategy_version_calculation_pins_pair
  on public.tax_strategy_version_calculation_pins (
    tax_strategy_version_id,
    calculation_definition_version_id
  );

create index if not exists idx_tax_strategy_version_calculation_pins_version
  on public.tax_strategy_version_calculation_pins (tax_strategy_version_id);

create index if not exists idx_tax_strategy_version_calculation_pins_country
  on public.tax_strategy_version_calculation_pins (country_code);

create or replace function public.tax_strategy_version_child_guard_country()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (
    select v.country_code
    from public.tax_strategy_versions v
    where v.id = new.tax_strategy_version_id
  ) is distinct from new.country_code then
    raise exception 'Cross-country tax strategy version child binding is forbidden';
  end if;

  if tg_table_name = 'tax_strategy_version_rule_pins' then
    if (
      select rv.country_code
      from public.tax_rule_versions rv
      where rv.id = new.tax_rule_version_id
    ) is distinct from new.country_code then
      raise exception 'Cross-country tax strategy rule pin is forbidden';
    end if;
  elsif tg_table_name = 'tax_strategy_version_calculation_pins' then
    if (
      select cv.country_code
      from public.tax_calculation_definition_versions cv
      where cv.id = new.calculation_definition_version_id
    ) is distinct from new.country_code then
      raise exception 'Cross-country tax strategy calculation pin is forbidden';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tax_strategy_version_rule_pins_country_guard
  on public.tax_strategy_version_rule_pins;
create trigger tax_strategy_version_rule_pins_country_guard
  before insert or update on public.tax_strategy_version_rule_pins
  for each row execute function public.tax_strategy_version_child_guard_country();

drop trigger if exists tax_strategy_version_calculation_pins_country_guard
  on public.tax_strategy_version_calculation_pins;
create trigger tax_strategy_version_calculation_pins_country_guard
  before insert or update on public.tax_strategy_version_calculation_pins
  for each row execute function public.tax_strategy_version_child_guard_country();

create or replace function public.tax_strategy_version_child_requires_parent_draft()
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
    from public.tax_strategy_versions v
    where v.id = old.tax_strategy_version_id;
    if old_status is distinct from 'draft' then
      raise exception
        'Tax strategy version children are immutable after the parent version leaves draft';
    end if;
    return old;
  end if;

  select v.status into new_status
  from public.tax_strategy_versions v
  where v.id = new.tax_strategy_version_id;
  if new_status is distinct from 'draft' then
    raise exception
      'Tax strategy version children are immutable after the parent version leaves draft';
  end if;

  if tg_op = 'UPDATE' then
    select v.status into old_status
    from public.tax_strategy_versions v
    where v.id = old.tax_strategy_version_id;
    if old_status is distinct from 'draft' then
      raise exception
        'Tax strategy version children are immutable after the parent version leaves draft';
    end if;
    if old.created_at is distinct from new.created_at then
      raise exception '%.created_at is immutable', tg_table_name;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tax_strategy_version_rule_pins_parent_draft_guard
  on public.tax_strategy_version_rule_pins;
create trigger tax_strategy_version_rule_pins_parent_draft_guard
  before insert or update or delete on public.tax_strategy_version_rule_pins
  for each row execute function public.tax_strategy_version_child_requires_parent_draft();

drop trigger if exists tax_strategy_version_calculation_pins_parent_draft_guard
  on public.tax_strategy_version_calculation_pins;
create trigger tax_strategy_version_calculation_pins_parent_draft_guard
  before insert or update or delete on public.tax_strategy_version_calculation_pins
  for each row execute function public.tax_strategy_version_child_requires_parent_draft();

drop trigger if exists tax_strategy_version_rule_pins_forbid_truncate
  on public.tax_strategy_version_rule_pins;
create trigger tax_strategy_version_rule_pins_forbid_truncate
  before truncate on public.tax_strategy_version_rule_pins
  execute function public.tax_strategy_forbid_truncate();

drop trigger if exists tax_strategy_version_calculation_pins_forbid_truncate
  on public.tax_strategy_version_calculation_pins;
create trigger tax_strategy_version_calculation_pins_forbid_truncate
  before truncate on public.tax_strategy_version_calculation_pins
  execute function public.tax_strategy_forbid_truncate();

-- Structural publication only. Does not require any pin, exclusive group, citation,
-- TRE evaluation, K4 calculation, facts, or professional-judgment justification.
create or replace function public.tax_strategy_versions_guard_publication()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.status is distinct from 'draft' or new.status is distinct from 'active' then
    return new;
  end if;

  if btrim(new.title) = '' then
    raise exception 'tax_strategy_versions cannot activate without a non-blank title';
  end if;

  if btrim(new.strategy_checksum) = '' then
    raise exception 'tax_strategy_versions cannot activate without a strategy_checksum';
  end if;

  if exists (
    select 1
    from public.tax_strategy_version_rule_pins pin
    join public.tax_rule_versions rv on rv.id = pin.tax_rule_version_id
    where pin.tax_strategy_version_id = new.id
      and rv.status is distinct from 'active'
  ) then
    raise exception
      'tax_strategy_versions cannot activate while a rule pin points at a non-active tax_rule_version';
  end if;

  if exists (
    select 1
    from public.tax_strategy_version_calculation_pins pin
    join public.tax_calculation_definition_versions cv
      on cv.id = pin.calculation_definition_version_id
    where pin.tax_strategy_version_id = new.id
      and cv.status is distinct from 'active'
  ) then
    raise exception
      'tax_strategy_versions cannot activate while a calculation pin points at a non-active tax_calculation_definition_version';
  end if;

  if exists (
    select 1
    from public.tax_strategy_version_rule_pins required_pin
    join public.tax_rule_versions required_rv
      on required_rv.id = required_pin.tax_rule_version_id
    join public.tax_strategy_version_rule_pins prohibited_pin
      on prohibited_pin.tax_strategy_version_id = required_pin.tax_strategy_version_id
     and prohibited_pin.pin_role = 'prohibited'
    join public.tax_rule_versions prohibited_rv
      on prohibited_rv.id = prohibited_pin.tax_rule_version_id
    where required_pin.tax_strategy_version_id = new.id
      and required_pin.pin_role = 'required'
      and required_rv.tax_rule_id = prohibited_rv.tax_rule_id
  ) then
    raise exception
      'tax_strategy_versions cannot activate with required and prohibited pins on the same tax_rule';
  end if;

  return new;
end;
$$;

comment on function public.tax_strategy_versions_guard_publication() is
  'E2 structural publication: if rule pins exist, each referenced tax_rule_version must be active; if calculation pins exist, each referenced tax_calculation_definition_version must be active; required/prohibited roles must be disjoint by tax_rule_id. Does not require any rule pin. Does not require any calculation pin. Does not require exclusive group, citation, TRE, K4, facts, or judgment justification. Does not require pinned rule windows to cover the strategy window. Does not walk the Tax Knowledge relationship graph. Does not rewrite historical rows after later pin-target retirement.';

drop trigger if exists tax_strategy_versions_publication_guard
  on public.tax_strategy_versions;
create trigger tax_strategy_versions_publication_guard
  before update on public.tax_strategy_versions
  for each row
  when (old.status = 'draft' and new.status = 'active')
  execute function public.tax_strategy_versions_guard_publication();

-- ==================================================
-- 6) Atomic supersession RPC
-- ==================================================

create or replace function public.tax_strategy_engine_supersede_tax_strategy_version(
  p_new_tax_strategy_version_id uuid,
  p_old_tax_strategy_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_new public.tax_strategy_versions%rowtype;
  v_old public.tax_strategy_versions%rowtype;
begin
  if p_new_tax_strategy_version_id is null or p_old_tax_strategy_version_id is null then
    raise exception 'new_tax_strategy_version_id and old_tax_strategy_version_id are required';
  end if;

  if p_new_tax_strategy_version_id = p_old_tax_strategy_version_id then
    raise exception 'new_tax_strategy_version_id and old_tax_strategy_version_id must be different';
  end if;

  -- Deterministic lock order. One transaction: later RAISE rolls back every UPDATE.
  perform 1
    from public.tax_strategy_versions
    where id in (p_new_tax_strategy_version_id, p_old_tax_strategy_version_id)
    order by id
    for update;

  select * into v_new
    from public.tax_strategy_versions
    where id = p_new_tax_strategy_version_id;
  if not found then
    raise exception 'Tax strategy version not found';
  end if;

  select * into v_old
    from public.tax_strategy_versions
    where id = p_old_tax_strategy_version_id;
  if not found then
    raise exception 'Tax strategy version not found';
  end if;

  if v_new.status is distinct from 'draft' then
    raise exception 'supersede_tax_strategy_version requires the NEW version to be draft';
  end if;

  if v_old.status is distinct from 'active' then
    raise exception 'supersede_tax_strategy_version requires the OLD version to be active';
  end if;

  if v_new.tax_strategy_id is distinct from v_old.tax_strategy_id then
    raise exception 'NEW and OLD tax strategy versions must belong to the same tax_strategy';
  end if;

  if v_new.country_code is distinct from v_old.country_code then
    raise exception 'NEW and OLD tax strategy versions must belong to the same country';
  end if;

  if v_new.supersedes_version_id is not null
    and v_new.supersedes_version_id is distinct from v_old.id
  then
    raise exception 'NEW.supersedes_version_id must be empty or exactly the OLD version';
  end if;

  -- OLD leaves active first so GiST overlap can admit NEW. Triggers stay enabled.
  -- Does not auto-write effective_to.
  update public.tax_strategy_versions
    set
      status = 'retired',
      superseded_by_version_id = v_new.id
    where id = v_old.id
      and status = 'active';
  if not found then
    raise exception 'supersede_tax_strategy_version requires the OLD version to be active';
  end if;

  -- Lineage + draft→active in one row update while the trigger still sees OLD.status=draft.
  -- Publication / immutability guards stay enabled.
  update public.tax_strategy_versions
    set
      supersedes_version_id = v_old.id,
      status = 'active'
    where id = v_new.id
      and status = 'draft';
  if not found then
    raise exception 'supersede_tax_strategy_version requires the NEW version to be draft';
  end if;

  return jsonb_build_object(
    'old_tax_strategy_version_id', v_old.id,
    'new_tax_strategy_version_id', v_new.id,
    'tax_strategy_id', v_new.tax_strategy_id,
    'country_code', v_new.country_code,
    'old_status', 'retired',
    'new_status', 'active'
  );
end;
$$;

comment on function public.tax_strategy_engine_supersede_tax_strategy_version(uuid, uuid) is
  'E2 atomic supersession. Locks both versions ORDER BY id, marks OLD active→retired with superseded_by_version_id=NEW, then NEW draft→active with supersedes_version_id=OLD. One transaction. Does not disable publication/immutability triggers. Does not auto-write effective_to. No latest-version fallback. service_role only.';

revoke all on function public.tax_strategy_engine_supersede_tax_strategy_version(uuid, uuid) from public;
revoke all on function public.tax_strategy_engine_supersede_tax_strategy_version(uuid, uuid) from anon, authenticated;
grant execute on function public.tax_strategy_engine_supersede_tax_strategy_version(uuid, uuid) to service_role;

-- ==================================================
-- 7) RLS + privilege hardening (in-foundation; no follow-up 613)
-- ==================================================

alter table public.tax_strategies enable row level security;
alter table public.tax_strategies force row level security;
alter table public.tax_strategy_exclusive_groups enable row level security;
alter table public.tax_strategy_exclusive_groups force row level security;
alter table public.tax_strategy_versions enable row level security;
alter table public.tax_strategy_versions force row level security;
alter table public.tax_strategy_version_rule_pins enable row level security;
alter table public.tax_strategy_version_rule_pins force row level security;
alter table public.tax_strategy_version_calculation_pins enable row level security;
alter table public.tax_strategy_version_calculation_pins force row level security;

revoke all on table public.tax_strategies from public, anon, authenticated, service_role;
revoke all on table public.tax_strategy_exclusive_groups from public, anon, authenticated, service_role;
revoke all on table public.tax_strategy_versions from public, anon, authenticated, service_role;
revoke all on table public.tax_strategy_version_rule_pins from public, anon, authenticated, service_role;
revoke all on table public.tax_strategy_version_calculation_pins from public, anon, authenticated, service_role;

grant select, insert, update, delete on table
  public.tax_strategies,
  public.tax_strategy_exclusive_groups,
  public.tax_strategy_versions,
  public.tax_strategy_version_rule_pins,
  public.tax_strategy_version_calculation_pins
  to service_role;

revoke all on function public.tax_strategy_json_is_string_array(jsonb) from public;
revoke all on function public.tax_strategy_json_is_string_array(jsonb) from anon, authenticated;
revoke all on function public.tax_strategy_authored_metadata_is_canonical(jsonb) from public;
revoke all on function public.tax_strategy_authored_metadata_is_canonical(jsonb) from anon, authenticated;
grant execute on function public.tax_strategy_json_is_string_array(jsonb) to service_role;
grant execute on function public.tax_strategy_authored_metadata_is_canonical(jsonb) to service_role;
