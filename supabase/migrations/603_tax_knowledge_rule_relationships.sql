-- TAX-K1.3 — Tax Knowledge rule relationships foundation.
-- Tax Brain reserved migration range: 600–699.
-- Scope: tax_rule_relationships only.
-- Does not alter migrations 600/601/602, Country Pack, legal values, commands, or UI.
-- No evaluator, AI, reverse-row generation, or supersession types.

-- ==================================================
-- tax_rule_relationships — exact version → exact version
-- ==================================================
create table if not exists public.tax_rule_relationships (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null,
  from_tax_rule_version_id uuid not null,
  to_tax_rule_version_id uuid not null,
  relationship_type text not null check (
    relationship_type in (
      'depends_on',
      'conflicts_with',
      'exception_to',
      'overrides',
      'alternative_to',
      'special_case_of',
      'elaborates'
    )
  ),
  status text not null default 'active' check (status in ('active', 'retired')),
  owner_note text null,
  created_at timestamptz not null default now(),
  retired_at timestamptz null,
  retired_reason text null,
  check (from_tax_rule_version_id <> to_tax_rule_version_id)
);

comment on table public.tax_rule_relationships is
  'TAX-K1.3 canonical version-to-version legal relationships. Same-country only. No organization_id. Mutable only while FROM tax_rule_version is draft. No auto-reverse rows. Supersession stays on tax_rule_versions.';

comment on column public.tax_rule_relationships.relationship_type is
  'Directional stored type. conflicts_with and alternative_to are stored once; no hidden reverse insert.';

alter table public.tax_rule_relationships
  add constraint tax_rule_relationships_from_version_country_fk
  foreign key (from_tax_rule_version_id, country_code)
  references public.tax_rule_versions (id, country_code)
  on delete restrict;

alter table public.tax_rule_relationships
  add constraint tax_rule_relationships_to_version_country_fk
  foreign key (to_tax_rule_version_id, country_code)
  references public.tax_rule_versions (id, country_code)
  on delete restrict;

-- Exact relationship identity. Retired rows remain; do not invent a second history row.
create unique index if not exists uq_tax_rule_relationships_edge
  on public.tax_rule_relationships (
    from_tax_rule_version_id,
    to_tax_rule_version_id,
    relationship_type
  );

create index if not exists idx_tax_rule_relationships_from
  on public.tax_rule_relationships (from_tax_rule_version_id);

create index if not exists idx_tax_rule_relationships_to
  on public.tax_rule_relationships (to_tax_rule_version_id);

create index if not exists idx_tax_rule_relationships_country
  on public.tax_rule_relationships (country_code);

create index if not exists idx_tax_rule_relationships_type
  on public.tax_rule_relationships (relationship_type);

-- ==================================================
-- Country-scope messages (composite FKs are the hard guarantee)
-- ==================================================
create or replace function public.tax_knowledge_relationships_guard_country()
returns trigger
language plpgsql
as $$
begin
  if (
    select v.country_code
    from public.tax_rule_versions v
    where v.id = new.from_tax_rule_version_id
  ) is distinct from new.country_code
    or (
      select v.country_code
      from public.tax_rule_versions v
      where v.id = new.to_tax_rule_version_id
    ) is distinct from new.country_code
  then
    raise exception 'Cross-country tax rule relationship is forbidden';
  end if;
  return new;
end;
$$;

drop trigger if exists tax_rule_relationships_country_guard
  on public.tax_rule_relationships;
create trigger tax_rule_relationships_country_guard
  before insert or update on public.tax_rule_relationships
  for each row execute function public.tax_knowledge_relationships_guard_country();

-- ==================================================
-- FROM-version lock: mutable only while FROM is draft
-- ==================================================
create or replace function public.tax_knowledge_relationship_requires_from_draft()
returns trigger
language plpgsql
as $$
declare
  old_status text;
  new_status text;
begin
  if tg_op = 'INSERT' and new.status is distinct from 'active' then
    raise exception 'tax_rule_relationships must be inserted as active';
  end if;

  if tg_op = 'DELETE' then
    select v.status into old_status
    from public.tax_rule_versions v
    where v.id = old.from_tax_rule_version_id;
    if old_status is distinct from 'draft' then
      raise exception 'Tax knowledge relationships are immutable after the FROM version leaves draft';
    end if;
    return old;
  end if;

  select v.status into new_status
  from public.tax_rule_versions v
  where v.id = new.from_tax_rule_version_id;
  if new_status is distinct from 'draft' then
    raise exception 'Tax knowledge relationships are immutable after the FROM version leaves draft';
  end if;

  if tg_op = 'UPDATE' then
    select v.status into old_status
    from public.tax_rule_versions v
    where v.id = old.from_tax_rule_version_id;
    if old_status is distinct from 'draft' then
      raise exception 'Tax knowledge relationships are immutable after the FROM version leaves draft';
    end if;
    if old.created_at is distinct from new.created_at then
      raise exception 'tax_rule_relationships.created_at is immutable';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tax_rule_relationships_from_draft_guard
  on public.tax_rule_relationships;
create trigger tax_rule_relationships_from_draft_guard
  before insert or update or delete on public.tax_rule_relationships
  for each row execute function public.tax_knowledge_relationship_requires_from_draft();

-- Truncate would wipe published relationship history; always forbidden.
drop trigger if exists tax_rule_relationships_forbid_truncate
  on public.tax_rule_relationships;
create trigger tax_rule_relationships_forbid_truncate
  before truncate on public.tax_rule_relationships
  execute function public.tax_knowledge_provenance_forbid_truncate();

-- ==================================================
-- RLS: platform canonical — same pattern as migrations 600/601
-- ==================================================
alter table public.tax_rule_relationships enable row level security;
alter table public.tax_rule_relationships force row level security;
revoke all on table public.tax_rule_relationships from anon, authenticated;

-- No CREATE POLICY on purpose.
