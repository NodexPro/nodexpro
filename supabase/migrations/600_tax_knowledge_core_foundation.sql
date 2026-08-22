-- TAX-K1.1 — Tax Knowledge Core DB foundation.
-- Tax Brain reserved migration range: 600–699.
-- Scope: tax_sources, tax_rules, tax_rule_versions + constraints/triggers/RLS only.
-- No commands, no API/UI, no assets, no relationships, no AI, no tenant cases.
--
-- Ownership:
--   Canonical tax/legal knowledge (platform-level). No organization_id.
--   Country Pack remains the country/pack/ruleset resolver and simple legal-value owner.
--   Statutory rates/limits/thresholds/calendars stay in country_legal_values.
--   payload_json is stored only — no evaluator in TAX-K1.
--
-- Writes later: Platform Owner commands via backend service_role.
-- Reads later: owner aggregates only. No tenant PostgREST access.

create extension if not exists btree_gist;

-- ==================================================
-- 1) tax_sources — canonical provenance identity (metadata only)
-- ==================================================
create table if not exists public.tax_sources (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null references public.countries(code) on delete restrict,
  source_code text not null,
  title text not null,
  provenance_type text not null check (
    provenance_type in (
      'official_law',
      'regulation',
      'circular',
      'official_guidance',
      'case_law_citation',
      'textbook',
      'professional_material',
      'other'
    )
  ),
  issuer text null,
  citation_ref text null,
  source_url text null,
  published_on date null,
  status text not null check (status in ('draft', 'active', 'retired')),
  owner_note text null,
  retired_at timestamptz null,
  retired_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(source_code) <> ''),
  check (btrim(title) <> '')
);

comment on table public.tax_sources is
  'TAX-K1 platform canonical tax/legal source identity. No tenant organization_id. Retirement instead of delete.';

create unique index if not exists uq_tax_sources_country_source_code
  on public.tax_sources (country_code, source_code);

create unique index if not exists uq_tax_sources_id_country
  on public.tax_sources (id, country_code);

create index if not exists idx_tax_sources_country
  on public.tax_sources (country_code);

create index if not exists idx_tax_sources_status
  on public.tax_sources (status);

create trigger tax_sources_updated_at
  before update on public.tax_sources
  for each row execute function public.set_updated_at();

-- ==================================================
-- 2) tax_rules — stable identity (not the versioned payload)
-- ==================================================
create table if not exists public.tax_rules (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null references public.countries(code) on delete restrict,
  rule_code text not null,
  title text not null,
  rule_kind text not null check (rule_kind in ('legal_rule')),
  status text not null check (status in ('draft', 'active', 'retired')),
  usage_hint text null,
  owner_note text null,
  retired_at timestamptz null,
  retired_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(rule_code) <> ''),
  check (btrim(title) <> '')
);

comment on table public.tax_rules is
  'TAX-K1 stable tax/legal rule identity. rule_code is immutable. Versions live in tax_rule_versions.';

create unique index if not exists uq_tax_rules_country_rule_code
  on public.tax_rules (country_code, rule_code);

create unique index if not exists uq_tax_rules_id_country
  on public.tax_rules (id, country_code);

create index if not exists idx_tax_rules_country
  on public.tax_rules (country_code);

create index if not exists idx_tax_rules_status
  on public.tax_rules (status);

create trigger tax_rules_updated_at
  before update on public.tax_rules
  for each row execute function public.set_updated_at();

-- ==================================================
-- 3) tax_rule_versions — immutable historical versions
-- ==================================================
create table if not exists public.tax_rule_versions (
  id uuid primary key default gen_random_uuid(),
  tax_rule_id uuid not null,
  country_code char(2) not null,
  country_pack_id uuid not null,
  country_pack_ruleset_id uuid not null,
  version_no integer not null,
  status text not null check (status in ('draft', 'active', 'superseded', 'retired')),
  effective_from date not null,
  effective_to date null,
  payload_json jsonb not null,
  payload_checksum text not null,
  supersedes_version_id uuid null,
  superseded_by_version_id uuid null,
  retired_at timestamptz null,
  retired_reason text null,
  created_at timestamptz not null default now(),
  check (version_no >= 1),
  check (btrim(payload_checksum) <> ''),
  check (jsonb_typeof(payload_json) = 'object'),
  check (effective_to is null or effective_to >= effective_from),
  check (supersedes_version_id is null or supersedes_version_id <> id),
  check (superseded_by_version_id is null or superseded_by_version_id <> id)
);

comment on table public.tax_rule_versions is
  'TAX-K1 immutable tax rule versions. INSERT status must be draft only. Draft may be revised; non-draft payload/identity/window-start are frozen.';

comment on column public.tax_rule_versions.payload_json is
  'Stored legal payload only. No evaluator in TAX-K1. Do not store statutory rates or money; those remain in country_legal_values.';

comment on column public.tax_rule_versions.payload_checksum is
  'Required. Backend command layer will compute canonical SHA-256 of payload_json. Do not trust a client-supplied checksum as truth.';

comment on column public.tax_rule_versions.version_no is
  'Monotonic per tax_rule_id. BEFORE INSERT trigger checks max+1; UNIQUE (tax_rule_id, version_no) is the concurrency guard. Racing inserts may fail; later command layer must retry. No extra locking in TAX-K1.1.';

-- Country isolation via existing composite-FK convention (086).
alter table public.tax_rule_versions
  add constraint tax_rule_versions_rule_country_fk
  foreign key (tax_rule_id, country_code)
  references public.tax_rules (id, country_code)
  on delete restrict;

alter table public.tax_rule_versions
  add constraint tax_rule_versions_pack_country_fk
  foreign key (country_pack_id, country_code)
  references public.country_packs (id, country_code)
  on delete restrict;

alter table public.tax_rule_versions
  add constraint tax_rule_versions_ruleset_pack_fk
  foreign key (country_pack_ruleset_id, country_pack_id)
  references public.country_pack_rulesets (id, country_pack_id)
  on delete restrict;

create unique index if not exists uq_tax_rule_versions_rule_version_no
  on public.tax_rule_versions (tax_rule_id, version_no);

create unique index if not exists uq_tax_rule_versions_id_country
  on public.tax_rule_versions (id, country_code);

create unique index if not exists uq_tax_rule_versions_id_rule
  on public.tax_rule_versions (id, tax_rule_id);

alter table public.tax_rule_versions
  add constraint tax_rule_versions_supersedes_same_rule_fk
  foreign key (supersedes_version_id, tax_rule_id)
  references public.tax_rule_versions (id, tax_rule_id)
  on delete restrict;

alter table public.tax_rule_versions
  add constraint tax_rule_versions_superseded_by_same_rule_fk
  foreign key (superseded_by_version_id, tax_rule_id)
  references public.tax_rule_versions (id, tax_rule_id)
  on delete restrict;

create index if not exists idx_tax_rule_versions_rule_id
  on public.tax_rule_versions (tax_rule_id);

create index if not exists idx_tax_rule_versions_country
  on public.tax_rule_versions (country_code);

create index if not exists idx_tax_rule_versions_pack
  on public.tax_rule_versions (country_pack_id);

create index if not exists idx_tax_rule_versions_ruleset
  on public.tax_rule_versions (country_pack_ruleset_id);

create index if not exists idx_tax_rule_versions_status
  on public.tax_rule_versions (status);

create index if not exists idx_tax_rule_versions_effective_dates
  on public.tax_rule_versions (tax_rule_id, effective_from, effective_to);

-- At most one ACTIVE version per tax_rule for any date (086 GiST overlap pattern).
alter table public.tax_rule_versions
  add constraint tax_rule_versions_no_active_overlap
  exclude using gist (
    tax_rule_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  )
  where (status = 'active');

-- ==================================================
-- Guards: country scope, monotonic version_no, immutability, rule_code, no-delete
-- ==================================================

create or replace function public.tax_rule_versions_guard_country_scope()
returns trigger
language plpgsql
as $$
begin
  if (
    select r.country_code
    from public.tax_rules r
    where r.id = new.tax_rule_id
  ) is distinct from new.country_code then
    raise exception 'Cross-country tax rule version binding is forbidden';
  end if;

  if (
    select cp.country_code
    from public.country_packs cp
    where cp.id = new.country_pack_id
  ) is distinct from new.country_code then
    raise exception 'Tax rule version pack country must match version country';
  end if;

  if (
    select rs.country_pack_id
    from public.country_pack_rulesets rs
    where rs.id = new.country_pack_ruleset_id
  ) is distinct from new.country_pack_id then
    raise exception 'Tax rule version ruleset must belong to the version country pack';
  end if;

  return new;
end;
$$;

drop trigger if exists tax_rule_versions_country_scope_guard
  on public.tax_rule_versions;

create trigger tax_rule_versions_country_scope_guard
  before insert or update on public.tax_rule_versions
  for each row execute function public.tax_rule_versions_guard_country_scope();

create or replace function public.tax_rule_versions_guard_monotonic_version_no()
returns trigger
language plpgsql
as $$
declare
  next_no integer;
begin
  select coalesce(max(v.version_no), 0) + 1
    into next_no
    from public.tax_rule_versions v
    where v.tax_rule_id = new.tax_rule_id;

  if new.version_no <> next_no then
    raise exception 'tax_rule_versions.version_no must be monotonic per tax_rule_id (expected %)', next_no;
  end if;

  return new;
end;
$$;

drop trigger if exists tax_rule_versions_monotonic_version_no_guard
  on public.tax_rule_versions;

create trigger tax_rule_versions_monotonic_version_no_guard
  before insert on public.tax_rule_versions
  for each row execute function public.tax_rule_versions_guard_monotonic_version_no();

create or replace function public.tax_rule_versions_guard_insert_draft_only()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from 'draft' then
    raise exception 'tax_rule_versions must be inserted as draft';
  end if;
  return new;
end;
$$;

drop trigger if exists tax_rule_versions_insert_draft_only
  on public.tax_rule_versions;

create trigger tax_rule_versions_insert_draft_only
  before insert on public.tax_rule_versions
  for each row execute function public.tax_rule_versions_guard_insert_draft_only();

create or replace function public.tax_rule_versions_protect_immutability()
returns trigger
language plpgsql
as $$
begin
  if old.created_at is distinct from new.created_at then
    raise exception 'tax_rule_versions.created_at is immutable';
  end if;

  if old.status is distinct from new.status then
    if not (
      (old.status = 'draft' and new.status in ('active', 'retired'))
      or (old.status = 'active' and new.status in ('superseded', 'retired'))
      or (old.status = 'superseded' and new.status = 'retired')
    ) then
      raise exception 'Invalid tax_rule_versions status transition: % → %', old.status, new.status;
    end if;
  end if;

  if old.status is distinct from 'draft' then
    if (
      old.tax_rule_id is distinct from new.tax_rule_id
      or old.country_code is distinct from new.country_code
      or old.country_pack_id is distinct from new.country_pack_id
      or old.country_pack_ruleset_id is distinct from new.country_pack_ruleset_id
      or old.version_no is distinct from new.version_no
      or old.payload_json is distinct from new.payload_json
      or old.payload_checksum is distinct from new.payload_checksum
      or old.effective_from is distinct from new.effective_from
      or old.supersedes_version_id is distinct from new.supersedes_version_id
    ) then
      raise exception 'tax_rule_versions identity/payload fields are immutable after leaving draft';
    end if;

    -- effective_to: close-out only while still active; frozen after supersession/retirement.
    if old.status in ('superseded', 'retired') then
      if old.effective_to is distinct from new.effective_to then
        raise exception 'tax_rule_versions.effective_to is frozen after supersession/retirement';
      end if;
    else
      if old.effective_to is null then
        null;
      else
        if new.effective_to is null then
          raise exception 'tax_rule_versions.effective_to cannot be cleared after close-out';
        end if;
        if new.effective_to > old.effective_to then
          raise exception 'tax_rule_versions.effective_to cannot be extended after leaving draft';
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tax_rule_versions_immutability_guard
  on public.tax_rule_versions;

create trigger tax_rule_versions_immutability_guard
  before update on public.tax_rule_versions
  for each row execute function public.tax_rule_versions_protect_immutability();

create or replace function public.tax_rule_versions_guard_supersession_cycle()
returns trigger
language plpgsql
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
        raise exception 'tax_rule_versions supersession chain too long';
      end if;
      if cursor_id = new.id then
        raise exception 'Circular tax rule supersession lineage is forbidden';
      end if;
      select v.supersedes_version_id
        into cursor_id
        from public.tax_rule_versions v
        where v.id = cursor_id;
    end loop;
  end if;

  if new.superseded_by_version_id is not null then
    cursor_id := new.superseded_by_version_id;
    seen := 0;
    while cursor_id is not null loop
      seen := seen + 1;
      if seen > 1000 then
        raise exception 'tax_rule_versions superseded_by chain too long';
      end if;
      if cursor_id = new.id then
        raise exception 'Circular tax rule superseded_by lineage is forbidden';
      end if;
      select v.superseded_by_version_id
        into cursor_id
        from public.tax_rule_versions v
        where v.id = cursor_id;
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists tax_rule_versions_supersession_cycle_guard
  on public.tax_rule_versions;

create trigger tax_rule_versions_supersession_cycle_guard
  before insert or update on public.tax_rule_versions
  for each row execute function public.tax_rule_versions_guard_supersession_cycle();

create or replace function public.tax_rules_protect_rule_code()
returns trigger
language plpgsql
as $$
begin
  if old.rule_code is distinct from new.rule_code then
    raise exception 'tax_rules.rule_code is immutable';
  end if;
  if old.country_code is distinct from new.country_code then
    raise exception 'tax_rules.country_code is immutable';
  end if;
  if old.created_at is distinct from new.created_at then
    raise exception 'tax_rules.created_at is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists tax_rules_rule_code_guard
  on public.tax_rules;

create trigger tax_rules_rule_code_guard
  before update on public.tax_rules
  for each row execute function public.tax_rules_protect_rule_code();

create or replace function public.tax_sources_protect_identity()
returns trigger
language plpgsql
as $$
begin
  if old.country_code is distinct from new.country_code then
    raise exception 'tax_sources.country_code is immutable';
  end if;
  if old.created_at is distinct from new.created_at then
    raise exception 'tax_sources.created_at is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists tax_sources_identity_guard on public.tax_sources;
create trigger tax_sources_identity_guard
  before update on public.tax_sources
  for each row execute function public.tax_sources_protect_identity();

create or replace function public.tax_knowledge_forbid_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Hard delete is forbidden for tax knowledge table %. Use retirement.', tg_table_name;
end;
$$;

drop trigger if exists tax_sources_forbid_delete on public.tax_sources;
create trigger tax_sources_forbid_delete
  before delete on public.tax_sources
  for each row execute function public.tax_knowledge_forbid_delete();

drop trigger if exists tax_rules_forbid_delete on public.tax_rules;
create trigger tax_rules_forbid_delete
  before delete on public.tax_rules
  for each row execute function public.tax_knowledge_forbid_delete();

drop trigger if exists tax_rule_versions_forbid_delete on public.tax_rule_versions;
create trigger tax_rule_versions_forbid_delete
  before delete on public.tax_rule_versions
  for each row execute function public.tax_knowledge_forbid_delete();

drop trigger if exists tax_sources_forbid_truncate on public.tax_sources;
create trigger tax_sources_forbid_truncate
  before truncate on public.tax_sources
  execute function public.tax_knowledge_forbid_delete();

drop trigger if exists tax_rules_forbid_truncate on public.tax_rules;
create trigger tax_rules_forbid_truncate
  before truncate on public.tax_rules
  execute function public.tax_knowledge_forbid_delete();

drop trigger if exists tax_rule_versions_forbid_truncate on public.tax_rule_versions;
create trigger tax_rule_versions_forbid_truncate
  before truncate on public.tax_rule_versions
  execute function public.tax_knowledge_forbid_delete();

-- ==================================================
-- RLS: platform canonical tables — no tenant authenticated policies
-- Pattern: 086 legal values (no tenant select) + 137 API-only revoke/force.
-- ==================================================
alter table public.tax_sources enable row level security;
alter table public.tax_sources force row level security;
revoke all on table public.tax_sources from anon, authenticated;

alter table public.tax_rules enable row level security;
alter table public.tax_rules force row level security;
revoke all on table public.tax_rules from anon, authenticated;

alter table public.tax_rule_versions enable row level security;
alter table public.tax_rule_versions force row level security;
revoke all on table public.tax_rule_versions from anon, authenticated;

-- No CREATE POLICY on purpose.
-- Tenant/office roles must not read or write canonical tax knowledge via PostgREST.
-- Backend service_role bypasses RLS for later Platform Owner commands/aggregates.
