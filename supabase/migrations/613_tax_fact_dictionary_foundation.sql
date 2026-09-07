-- TAX-F2A1 — Tax Brain Fact Dictionary foundation.
-- Tax Brain reserved migration range: 600–699.
-- Scope: fact identity, semantic definition versions, enum option codes,
--        presentation/i18n, constraints/triggers/RLS only.
-- Does not alter migrations 600–612, 086, or 163.
-- No commands, no aggregates, no UI, no Tax Advisory case/scenario/recommendation
-- tables, no K3/K4/Strategy publication guards, no Accounting Base writes.
--
-- Ownership:
--   Fact Dictionary owns canonical fact identity/type/validation/enum codes.
--   Tax Knowledge owns legal rule applicability and predicates (later references keys).
--   Calculation Engine owns calculation definitions (later references the same keys).
--   Strategy Engine owns canonical legal treatments.
--   Country Pack owns statutory legal values — not client-fact identity.
--   Tax Advisory will own tenant/client/case values later — not this migration.
--
-- No organization_id / client_id / case_id.
-- No latest-version resolution.
-- Backend will compute definition_checksum later. SQL stores and freezes it; it does
-- not hash authored content. effective_from / effective_to are publication windows
-- and are excluded from definition_checksum. Presentation/i18n is excluded.

create extension if not exists btree_gist;

-- ==================================================
-- Shared helpers / guards
-- ==================================================

create or replace function public.tax_fact_forbid_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Hard delete is forbidden for tax fact dictionary table %. Use retirement.', tg_table_name;
end;
$$;

create or replace function public.tax_fact_forbid_truncate()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'TRUNCATE is forbidden for tax fact dictionary table %.', tg_table_name;
end;
$$;

create or replace function public.tax_fact_key_is_snake_case(p text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select p is not null and p ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$';
$$;

comment on function public.tax_fact_key_is_snake_case(text) is
  'F2A1 stable engine key / enum code shape: leading lowercase letter, optional _[a-z0-9]+ segments. evaluation_as_of is reserved separately.';

create or replace function public.tax_fact_json_is_string_array(p jsonb)
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
        select bool_and(jsonb_typeof(elem) = 'string' and btrim(elem #>> '{}') <> '')
        from jsonb_array_elements(p) elem
      ), true)
    );
$$;

create or replace function public.tax_fact_currency_policy_is_canonical(p jsonb, p_value_type text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select
    case
      when p_value_type is distinct from 'money' then p is null
      else
        jsonb_typeof(p) = 'object'
        and (p ? 'required')
        and jsonb_typeof(p -> 'required') = 'boolean'
        and (p - array['required', 'allowed_currencies']) = '{}'::jsonb
        and (
          not (p ? 'allowed_currencies')
          or (
            jsonb_typeof(p -> 'allowed_currencies') = 'array'
            and coalesce((
              select bool_and(
                jsonb_typeof(elem) = 'string'
                and (elem #>> '{}') ~ '^[A-Z]{3}$'
              )
              from jsonb_array_elements(p -> 'allowed_currencies') elem
            ), true)
          )
        )
    end;
$$;

comment on function public.tax_fact_currency_policy_is_canonical(jsonb, text) is
  'F2A1 money facts require { required: boolean, allowed_currencies?: string[] of ISO-4217 codes }. Non-money facts must store currency_policy NULL.';

create or replace function public.tax_fact_enum_option_labels_is_canonical(p jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select
    jsonb_typeof(p) = 'object'
    and coalesce((
      select bool_and(
        public.tax_fact_key_is_snake_case(key)
        and jsonb_typeof(value) = 'string'
        and btrim(value #>> '{}') <> ''
      )
      from jsonb_each(p)
    ), true);
$$;

comment on function public.tax_fact_enum_option_labels_is_canonical(jsonb) is
  'F2A1 presentation-only enum labels keyed by semantic option code. Excluded from definition_checksum. No fifth table in this slice.';

-- ==================================================
-- 1) tax_fact_definitions — stable identity
-- ==================================================

create table if not exists public.tax_fact_definitions (
  id uuid primary key default gen_random_uuid(),
  fact_key text not null,
  country_code char(2) null references public.countries(code) on delete restrict,
  status text not null check (status in ('draft', 'active', 'retired')),
  semantic_title text not null,
  owner_note text null,
  retired_at timestamptz null,
  retired_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (public.tax_fact_key_is_snake_case(fact_key)),
  check (fact_key <> 'evaluation_as_of'),
  check (btrim(semantic_title) <> ''),
  check (owner_note is null or btrim(owner_note) <> '')
);

comment on table public.tax_fact_definitions is
  'F2A1 platform-canonical fact identity. country_code NULL = global; ISO country = country-specific. No organization_id. fact_key is the engine key for K3/K4 later. Not Country Pack legal values. Not Tax Advisory case facts.';

comment on column public.tax_fact_definitions.fact_key is
  'Immutable snake_case engine key. Country is NOT encoded into the key. evaluation_as_of is reserved. Excluded from presentation/i18n.';

comment on column public.tax_fact_definitions.country_code is
  'NULL = global fact. Non-null = that country only. Immutable. Israeli enum semantics must not live on a global identity.';

comment on column public.tax_fact_definitions.semantic_title is
  'Owner catalog title. Not translated presentation. Excluded from definition_checksum.';

comment on column public.tax_fact_definitions.owner_note is
  'Owner administrative note. Excluded from definition_checksum.';

-- NULL-safe uniqueness: ordinary UNIQUE(country_code, fact_key) would allow duplicate globals.
create unique index if not exists uq_tax_fact_definitions_global_fact_key
  on public.tax_fact_definitions (fact_key)
  where country_code is null;

create unique index if not exists uq_tax_fact_definitions_country_fact_key
  on public.tax_fact_definitions (country_code, fact_key)
  where country_code is not null;

create unique index if not exists uq_tax_fact_definitions_id_country
  on public.tax_fact_definitions (id, country_code);

create index if not exists idx_tax_fact_definitions_country
  on public.tax_fact_definitions (country_code);

create index if not exists idx_tax_fact_definitions_status
  on public.tax_fact_definitions (status);

create trigger tax_fact_definitions_updated_at
  before update on public.tax_fact_definitions
  for each row execute function public.set_updated_at();

create or replace function public.tax_fact_definitions_guard_insert_draft_only()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status is distinct from 'draft' then
    raise exception 'tax_fact_definitions must be inserted as draft';
  end if;
  return new;
end;
$$;

drop trigger if exists tax_fact_definitions_insert_draft_only
  on public.tax_fact_definitions;
create trigger tax_fact_definitions_insert_draft_only
  before insert on public.tax_fact_definitions
  for each row execute function public.tax_fact_definitions_guard_insert_draft_only();

create or replace function public.tax_fact_definitions_guard_key_namespace()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  -- Serialize only writers of this exact engine key. Same fact_key always
  -- takes the same lock whether the row is global, IL, US, or any country.
  -- Namespace 613 avoids colliding with other two-int advisory locks.
  -- hashtext collisions only wait; they never reject an unrelated key.
  perform pg_advisory_xact_lock(613, hashtext(new.fact_key));

  if new.country_code is null then
    if exists (
      select 1
      from public.tax_fact_definitions d
      where d.fact_key = new.fact_key
        and d.country_code is not null
        and d.id is distinct from new.id
    ) then
      raise exception
        'global fact_key must not collide with a country-scoped fact_key (engine namespace)';
    end if;
  else
    if exists (
      select 1
      from public.tax_fact_definitions d
      where d.fact_key = new.fact_key
        and d.country_code is null
        and d.id is distinct from new.id
    ) then
      raise exception
        'country-scoped fact_key must not collide with a global fact_key (engine namespace)';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.tax_fact_definitions_guard_key_namespace() is
  'Race-safe engine-key namespace: pg_advisory_xact_lock(613, hashtext(fact_key)) then SELECT for global-vs-country collision. Partial unique indexes still own duplicate-global and same-country uniqueness. Same fact_key in two countries remains legal.';

drop trigger if exists tax_fact_definitions_key_namespace_guard
  on public.tax_fact_definitions;
create trigger tax_fact_definitions_key_namespace_guard
  before insert or update of fact_key, country_code on public.tax_fact_definitions
  for each row execute function public.tax_fact_definitions_guard_key_namespace();

create or replace function public.tax_fact_definitions_protect_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.fact_key is distinct from new.fact_key then
    raise exception 'tax_fact_definitions.fact_key is immutable';
  end if;
  if old.country_code is distinct from new.country_code then
    raise exception 'tax_fact_definitions.country_code is immutable';
  end if;
  if old.created_at is distinct from new.created_at then
    raise exception 'tax_fact_definitions.created_at is immutable';
  end if;

  if old.status is distinct from new.status then
    if not (
      (old.status = 'draft' and new.status in ('active', 'retired'))
      or (old.status = 'active' and new.status = 'retired')
    ) then
      raise exception
        'Invalid tax_fact_definitions status transition: % → %',
        old.status,
        new.status;
    end if;
    if new.status = 'retired' and new.retired_at is null then
      new.retired_at := now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tax_fact_definitions_identity_guard
  on public.tax_fact_definitions;
create trigger tax_fact_definitions_identity_guard
  before update on public.tax_fact_definitions
  for each row execute function public.tax_fact_definitions_protect_identity();

drop trigger if exists tax_fact_definitions_forbid_delete
  on public.tax_fact_definitions;
create trigger tax_fact_definitions_forbid_delete
  before delete on public.tax_fact_definitions
  for each row execute function public.tax_fact_forbid_delete();

drop trigger if exists tax_fact_definitions_forbid_truncate
  on public.tax_fact_definitions;
create trigger tax_fact_definitions_forbid_truncate
  before truncate on public.tax_fact_definitions
  execute function public.tax_fact_forbid_truncate();

-- ==================================================
-- 2) tax_fact_definition_versions — semantic definition version
-- ==================================================

create table if not exists public.tax_fact_definition_versions (
  id uuid primary key default gen_random_uuid(),
  tax_fact_definition_id uuid not null references public.tax_fact_definitions(id) on delete restrict,
  country_code char(2) null references public.countries(code) on delete restrict,
  version_no integer not null,
  status text not null check (status in ('draft', 'active', 'retired')),
  value_type text not null check (
    value_type in (
      'boolean',
      'integer',
      'decimal',
      'money',
      'percentage',
      'date',
      'enum',
      'string'
    )
  ),
  unit_code text null,
  currency_policy jsonb null,
  validation_json jsonb not null default '{}'::jsonb,
  definition_checksum text not null,
  effective_from date not null,
  effective_to date null,
  activated_at timestamptz null,
  retired_at timestamptz null,
  retired_reason text null,
  created_at timestamptz not null default now(),
  check (version_no >= 1),
  check (btrim(definition_checksum) <> ''),
  check (unit_code is null or (btrim(unit_code) <> '' and public.tax_fact_key_is_snake_case(unit_code))),
  check (jsonb_typeof(validation_json) = 'object'),
  check (public.tax_fact_currency_policy_is_canonical(currency_policy, value_type)),
  check (effective_to is null or effective_to >= effective_from)
);

comment on table public.tax_fact_definition_versions is
  'F2A1 versioned semantic fact definition. Draft mutable; active/retired semantic payload immutable. Exact-version historical identity. Backend computes definition_checksum; SQL does not hash authored content. No identity-level supersession.';

comment on column public.tax_fact_definition_versions.country_code is
  'Denormalized from tax_fact_definitions. NULL for global facts. PostgreSQL MATCH SIMPLE composite FKs cannot enforce NULL country, so a trigger requires IS NOT DISTINCT FROM the parent.';

comment on column public.tax_fact_definition_versions.definition_checksum is
  'Backend-computed SHA-256 of canonical semantic CONTENT only: fact_key, country_code, value_type, unit_code, currency_policy, validation_json, sorted enum option codes. Excludes status, version_no, effective_from, effective_to, timestamps, ids, presentation/i18n, owner_note, semantic_title, retired_reason. SQL stores/freezes it and does not compute or digest it.';

comment on column public.tax_fact_definition_versions.effective_from is
  'Publication window start. Excluded from definition_checksum. Frozen after leaving draft.';

comment on column public.tax_fact_definition_versions.effective_to is
  'Publication window end. Excluded from definition_checksum. Nullable while active; may be narrowed while active; frozen after retirement.';

comment on column public.tax_fact_definition_versions.value_type is
  'K4-compatible types only: boolean, integer, decimal, money, percentage, date, enum, string. No string_list, enum_list, or json in v1.';

create unique index if not exists uq_tax_fact_definition_versions_def_no
  on public.tax_fact_definition_versions (tax_fact_definition_id, version_no);

create unique index if not exists uq_tax_fact_definition_versions_id_country
  on public.tax_fact_definition_versions (id, country_code);

create unique index if not exists uq_tax_fact_definition_versions_id_definition
  on public.tax_fact_definition_versions (id, tax_fact_definition_id);

create index if not exists idx_tax_fact_definition_versions_definition
  on public.tax_fact_definition_versions (tax_fact_definition_id);

create index if not exists idx_tax_fact_definition_versions_country
  on public.tax_fact_definition_versions (country_code);

create index if not exists idx_tax_fact_definition_versions_status
  on public.tax_fact_definition_versions (status);

create index if not exists idx_tax_fact_definition_versions_effective
  on public.tax_fact_definition_versions (tax_fact_definition_id, effective_from, effective_to);

alter table public.tax_fact_definition_versions
  add constraint tax_fact_definition_versions_no_active_overlap
  exclude using gist (
    tax_fact_definition_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  )
  where (status = 'active');

create or replace function public.tax_fact_definition_versions_guard_country()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  parent_country char(2);
  parent_status text;
begin
  select d.country_code, d.status
    into parent_country, parent_status
    from public.tax_fact_definitions d
    where d.id = new.tax_fact_definition_id;

  if parent_country is distinct from new.country_code then
    raise exception
      'tax_fact_definition_versions.country_code must match tax_fact_definitions.country_code';
  end if;

  if tg_op = 'INSERT' and parent_status = 'retired' then
    raise exception 'Cannot insert a fact definition version on a retired fact identity';
  end if;

  return new;
end;
$$;

drop trigger if exists tax_fact_definition_versions_country_guard
  on public.tax_fact_definition_versions;
create trigger tax_fact_definition_versions_country_guard
  before insert or update on public.tax_fact_definition_versions
  for each row execute function public.tax_fact_definition_versions_guard_country();

create or replace function public.tax_fact_definition_versions_guard_monotonic_version_no()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  next_no integer;
begin
  select coalesce(max(v.version_no), 0) + 1
    into next_no
    from public.tax_fact_definition_versions v
    where v.tax_fact_definition_id = new.tax_fact_definition_id;

  if new.version_no <> next_no then
    raise exception
      'tax_fact_definition_versions.version_no must be monotonic per definition (expected %)',
      next_no;
  end if;
  return new;
end;
$$;

drop trigger if exists tax_fact_definition_versions_monotonic_version_no_guard
  on public.tax_fact_definition_versions;
create trigger tax_fact_definition_versions_monotonic_version_no_guard
  before insert on public.tax_fact_definition_versions
  for each row execute function public.tax_fact_definition_versions_guard_monotonic_version_no();

create or replace function public.tax_fact_definition_versions_guard_insert_draft_only()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status is distinct from 'draft' then
    raise exception 'tax_fact_definition_versions must be inserted as draft';
  end if;
  return new;
end;
$$;

drop trigger if exists tax_fact_definition_versions_insert_draft_only
  on public.tax_fact_definition_versions;
create trigger tax_fact_definition_versions_insert_draft_only
  before insert on public.tax_fact_definition_versions
  for each row execute function public.tax_fact_definition_versions_guard_insert_draft_only();

create or replace function public.tax_fact_definition_versions_protect_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.created_at is distinct from new.created_at then
    raise exception 'tax_fact_definition_versions.created_at is immutable';
  end if;

  if old.status is distinct from new.status then
    if not (
      (old.status = 'draft' and new.status in ('active', 'retired'))
      or (old.status = 'active' and new.status = 'retired')
    ) then
      raise exception
        'Invalid tax_fact_definition_versions status transition: % → %',
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
      old.tax_fact_definition_id is distinct from new.tax_fact_definition_id
      or old.country_code is distinct from new.country_code
      or old.version_no is distinct from new.version_no
      or old.value_type is distinct from new.value_type
      or old.unit_code is distinct from new.unit_code
      or old.currency_policy is distinct from new.currency_policy
      or old.validation_json is distinct from new.validation_json
      or old.definition_checksum is distinct from new.definition_checksum
      or old.effective_from is distinct from new.effective_from
      or old.activated_at is distinct from new.activated_at
    ) then
      raise exception
        'tax_fact_definition_versions semantic fields are immutable after leaving draft';
    end if;

    if old.status = 'retired' then
      if old.effective_to is distinct from new.effective_to then
        raise exception
          'tax_fact_definition_versions.effective_to is frozen after retirement';
      end if;
    else
      if old.effective_to is not null then
        if new.effective_to is null then
          raise exception
            'tax_fact_definition_versions.effective_to cannot be cleared after close-out';
        end if;
        if new.effective_to > old.effective_to then
          raise exception
            'tax_fact_definition_versions.effective_to cannot be extended after leaving draft';
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tax_fact_definition_versions_immutability_guard
  on public.tax_fact_definition_versions;
create trigger tax_fact_definition_versions_immutability_guard
  before update on public.tax_fact_definition_versions
  for each row execute function public.tax_fact_definition_versions_protect_immutability();

drop trigger if exists tax_fact_definition_versions_forbid_delete
  on public.tax_fact_definition_versions;
create trigger tax_fact_definition_versions_forbid_delete
  before delete on public.tax_fact_definition_versions
  for each row execute function public.tax_fact_forbid_delete();

drop trigger if exists tax_fact_definition_versions_forbid_truncate
  on public.tax_fact_definition_versions;
create trigger tax_fact_definition_versions_forbid_truncate
  before truncate on public.tax_fact_definition_versions
  execute function public.tax_fact_forbid_truncate();

-- ==================================================
-- 3) tax_fact_enum_options — semantic codes on an exact version
-- ==================================================

create table if not exists public.tax_fact_enum_options (
  id uuid primary key default gen_random_uuid(),
  tax_fact_definition_version_id uuid not null references public.tax_fact_definition_versions(id) on delete restrict,
  code text not null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  check (public.tax_fact_key_is_snake_case(code)),
  check (sort_order >= 0)
);

comment on table public.tax_fact_enum_options is
  'F2A1 semantic enum codes tied to an exact fact definition version. Labels/translations live on presentations, not here. INSERT/UPDATE/DELETE allowed only while the parent version is draft. Published child DELETE is forbidden. tax_fact_forbid_delete is not attached here.';

create unique index if not exists uq_tax_fact_enum_options_version_code
  on public.tax_fact_enum_options (tax_fact_definition_version_id, code);

create index if not exists idx_tax_fact_enum_options_version
  on public.tax_fact_enum_options (tax_fact_definition_version_id);

create or replace function public.tax_fact_enum_options_requires_enum_parent()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  parent_type text;
begin
  select v.value_type
    into parent_type
    from public.tax_fact_definition_versions v
    where v.id = new.tax_fact_definition_version_id;

  if parent_type is distinct from 'enum' then
    raise exception 'tax_fact_enum_options are only valid on value_type = enum versions';
  end if;
  return new;
end;
$$;

drop trigger if exists tax_fact_enum_options_enum_parent_guard
  on public.tax_fact_enum_options;
create trigger tax_fact_enum_options_enum_parent_guard
  before insert or update on public.tax_fact_enum_options
  for each row execute function public.tax_fact_enum_options_requires_enum_parent();

create or replace function public.tax_fact_enum_options_requires_parent_draft()
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
    from public.tax_fact_definition_versions v
    where v.id = old.tax_fact_definition_version_id;
    if old_status is distinct from 'draft' then
      raise exception
        'tax_fact_enum_options are immutable after the parent version leaves draft';
    end if;
    return old;
  end if;

  select v.status into new_status
  from public.tax_fact_definition_versions v
  where v.id = new.tax_fact_definition_version_id;
  if new_status is distinct from 'draft' then
    raise exception
      'tax_fact_enum_options are immutable after the parent version leaves draft';
  end if;

  if tg_op = 'UPDATE' then
    select v.status into old_status
    from public.tax_fact_definition_versions v
    where v.id = old.tax_fact_definition_version_id;
    if old_status is distinct from 'draft' then
      raise exception
        'tax_fact_enum_options are immutable after the parent version leaves draft';
    end if;
    if old.created_at is distinct from new.created_at then
      raise exception 'tax_fact_enum_options.created_at is immutable';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tax_fact_enum_options_parent_draft_guard
  on public.tax_fact_enum_options;
create trigger tax_fact_enum_options_parent_draft_guard
  before insert or update or delete on public.tax_fact_enum_options
  for each row execute function public.tax_fact_enum_options_requires_parent_draft();

drop trigger if exists tax_fact_enum_options_forbid_truncate
  on public.tax_fact_enum_options;
create trigger tax_fact_enum_options_forbid_truncate
  before truncate on public.tax_fact_enum_options
  execute function public.tax_fact_forbid_truncate();

create or replace function public.tax_fact_definition_versions_guard_publication()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  identity_status text;
  option_count integer;
begin
  if old.status is distinct from 'draft' or new.status is distinct from 'active' then
    return new;
  end if;

  select d.status
    into identity_status
    from public.tax_fact_definitions d
    where d.id = new.tax_fact_definition_id;

  if identity_status is distinct from 'active' then
    raise exception
      'tax_fact_definition_versions cannot activate unless the fact identity is active';
  end if;

  if btrim(new.definition_checksum) = '' then
    raise exception 'tax_fact_definition_versions cannot activate without a definition_checksum';
  end if;

  select count(*)
    into option_count
    from public.tax_fact_enum_options o
    where o.tax_fact_definition_version_id = new.id;

  if new.value_type = 'enum' and option_count < 1 then
    raise exception
      'tax_fact_definition_versions cannot activate an enum without at least one enum option';
  end if;

  if new.value_type is distinct from 'enum' and option_count <> 0 then
    raise exception
      'tax_fact_definition_versions cannot activate a non-enum version that has enum options';
  end if;

  return new;
end;
$$;

comment on function public.tax_fact_definition_versions_guard_publication() is
  'F2A1 structural publication: identity must be active; enum versions need >=1 option; non-enum versions must have zero options. Does not hash checksums. Does not call K3/K4/Strategy.';

drop trigger if exists tax_fact_definition_versions_publication_guard
  on public.tax_fact_definition_versions;
create trigger tax_fact_definition_versions_publication_guard
  before update on public.tax_fact_definition_versions
  for each row
  when (old.status = 'draft' and new.status = 'active')
  execute function public.tax_fact_definition_versions_guard_publication();

-- ==================================================
-- 4) tax_fact_presentations — human/i18n only; not in definition_checksum
-- ==================================================

create table if not exists public.tax_fact_presentations (
  id uuid primary key default gen_random_uuid(),
  tax_fact_definition_id uuid not null references public.tax_fact_definitions(id) on delete restrict,
  country_code char(2) null references public.countries(code) on delete restrict,
  locale text not null,
  label text not null,
  professional_question text not null,
  client_question text null,
  help_text text null,
  aliases jsonb not null default '[]'::jsonb,
  enum_option_labels jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (locale = lower(locale) and locale ~ '^[a-z]{2}(-[a-z]{2})?$'),
  check (btrim(label) <> ''),
  check (btrim(professional_question) <> ''),
  check (client_question is null or btrim(client_question) <> ''),
  check (help_text is null or btrim(help_text) <> ''),
  check (public.tax_fact_json_is_string_array(aliases)),
  check (public.tax_fact_enum_option_labels_is_canonical(enum_option_labels))
);

comment on table public.tax_fact_presentations is
  'F2A1 presentation/i18n for a fact identity. Not a semantic version. Editable without a new definition version. Excluded from definition_checksum. enum_option_labels is a code→label map so enum translations do not need a fifth table.';

comment on column public.tax_fact_presentations.country_code is
  'NULL = default wording for the identity. For country-scoped facts must equal the identity country. For global facts may be a country-specific wording overlay.';

comment on column public.tax_fact_presentations.locale is
  'Normalized lowercase BCP 47 language tag: xx or xx-yy (e.g. he, en, ru, he-il).';

comment on column public.tax_fact_presentations.aliases is
  'Future LLM/synonym mapping only. Presentation. Never an engine key and never part of definition_checksum.';

comment on column public.tax_fact_presentations.enum_option_labels is
  'Presentation labels for semantic enum codes. Keys are option codes; values are non-blank strings. Not semantic enum identity.';

create unique index if not exists uq_tax_fact_presentations_def_locale_global
  on public.tax_fact_presentations (tax_fact_definition_id, locale)
  where country_code is null;

create unique index if not exists uq_tax_fact_presentations_def_country_locale
  on public.tax_fact_presentations (tax_fact_definition_id, country_code, locale)
  where country_code is not null;

create index if not exists idx_tax_fact_presentations_definition
  on public.tax_fact_presentations (tax_fact_definition_id);

create index if not exists idx_tax_fact_presentations_locale
  on public.tax_fact_presentations (locale);

create trigger tax_fact_presentations_updated_at
  before update on public.tax_fact_presentations
  for each row execute function public.set_updated_at();

create or replace function public.tax_fact_presentations_normalize_and_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  parent_country char(2);
begin
  new.locale := lower(btrim(new.locale));

  select d.country_code
    into parent_country
    from public.tax_fact_definitions d
    where d.id = new.tax_fact_definition_id;

  if parent_country is not null and new.country_code is distinct from parent_country then
    raise exception
      'country-scoped fact presentations must use the identity country_code';
  end if;

  if tg_op = 'UPDATE' and old.created_at is distinct from new.created_at then
    raise exception 'tax_fact_presentations.created_at is immutable';
  end if;

  return new;
end;
$$;

drop trigger if exists tax_fact_presentations_scope_guard
  on public.tax_fact_presentations;
create trigger tax_fact_presentations_scope_guard
  before insert or update on public.tax_fact_presentations
  for each row execute function public.tax_fact_presentations_normalize_and_scope();

drop trigger if exists tax_fact_presentations_forbid_truncate
  on public.tax_fact_presentations;
create trigger tax_fact_presentations_forbid_truncate
  before truncate on public.tax_fact_presentations
  execute function public.tax_fact_forbid_truncate();

-- ==================================================
-- 5) RLS + privilege hardening (in-foundation; follow 612)
-- ==================================================

alter table public.tax_fact_definitions enable row level security;
alter table public.tax_fact_definitions force row level security;
alter table public.tax_fact_definition_versions enable row level security;
alter table public.tax_fact_definition_versions force row level security;
alter table public.tax_fact_enum_options enable row level security;
alter table public.tax_fact_enum_options force row level security;
alter table public.tax_fact_presentations enable row level security;
alter table public.tax_fact_presentations force row level security;

revoke all on table public.tax_fact_definitions from public, anon, authenticated, service_role;
revoke all on table public.tax_fact_definition_versions from public, anon, authenticated, service_role;
revoke all on table public.tax_fact_enum_options from public, anon, authenticated, service_role;
revoke all on table public.tax_fact_presentations from public, anon, authenticated, service_role;

grant select, insert, update, delete on table
  public.tax_fact_definitions,
  public.tax_fact_definition_versions,
  public.tax_fact_enum_options,
  public.tax_fact_presentations
  to service_role;

revoke all on function public.tax_fact_key_is_snake_case(text) from public;
revoke all on function public.tax_fact_key_is_snake_case(text) from anon, authenticated;
revoke all on function public.tax_fact_json_is_string_array(jsonb) from public;
revoke all on function public.tax_fact_json_is_string_array(jsonb) from anon, authenticated;
revoke all on function public.tax_fact_currency_policy_is_canonical(jsonb, text) from public;
revoke all on function public.tax_fact_currency_policy_is_canonical(jsonb, text) from anon, authenticated;
revoke all on function public.tax_fact_enum_option_labels_is_canonical(jsonb) from public;
revoke all on function public.tax_fact_enum_option_labels_is_canonical(jsonb) from anon, authenticated;

grant execute on function public.tax_fact_key_is_snake_case(text) to service_role;
grant execute on function public.tax_fact_json_is_string_array(jsonb) to service_role;
grant execute on function public.tax_fact_currency_policy_is_canonical(jsonb, text) to service_role;
grant execute on function public.tax_fact_enum_option_labels_is_canonical(jsonb) to service_role;
