-- TAX-K1.2 — Tax Knowledge provenance links.
-- Tax Brain reserved migration range: 600–699.
-- Scope: tax_rule_version_sources + tax_rule_version_legal_values only.
-- Does not alter migration 600 / Country Pack / legal-value payloads.
-- No relationships, source assets, AI, advisory cases, commands, or UI.

-- ==================================================
-- 1) tax_rule_version_sources — version ↔ source citations
-- ==================================================
create table if not exists public.tax_rule_version_sources (
  id uuid primary key default gen_random_uuid(),
  tax_rule_version_id uuid not null,
  tax_source_id uuid not null,
  country_code char(2) not null,
  locator text null,
  created_at timestamptz not null default now(),
  check (locator is null or btrim(locator) <> '')
);

comment on table public.tax_rule_version_sources is
  'TAX-K1.2 citation pins. Same-country only. No organization_id. Mutable only while parent tax_rule_version is draft.';

comment on column public.tax_rule_version_sources.locator is
  'Optional article/section/paragraph/page/clause pin. NULL means the source as a whole.';

alter table public.tax_rule_version_sources
  add constraint tax_rule_version_sources_version_country_fk
  foreign key (tax_rule_version_id, country_code)
  references public.tax_rule_versions (id, country_code)
  on delete restrict;

alter table public.tax_rule_version_sources
  add constraint tax_rule_version_sources_source_country_fk
  foreign key (tax_source_id, country_code)
  references public.tax_sources (id, country_code)
  on delete restrict;

-- PostgreSQL UNIQUE treats NULL locator as distinct; coalesce so one "no locator" pin per version+source.
create unique index if not exists uq_tax_rule_version_sources_citation
  on public.tax_rule_version_sources (
    tax_rule_version_id,
    tax_source_id,
    coalesce(btrim(locator), '')
  );

create index if not exists idx_tax_rule_version_sources_version
  on public.tax_rule_version_sources (tax_rule_version_id);

create index if not exists idx_tax_rule_version_sources_source
  on public.tax_rule_version_sources (tax_source_id);

create index if not exists idx_tax_rule_version_sources_country
  on public.tax_rule_version_sources (country_code);

-- ==================================================
-- 2) tax_rule_version_legal_values — version ↔ Country Pack legal values
-- ==================================================
create table if not exists public.tax_rule_version_legal_values (
  id uuid primary key default gen_random_uuid(),
  tax_rule_version_id uuid not null,
  legal_value_id uuid not null,
  country_code char(2) not null,
  created_at timestamptz not null default now()
);

comment on table public.tax_rule_version_legal_values is
  'TAX-K1.2 legal-value references only. Does not copy rates/thresholds/payloads. Country Pack remains canonical.';

alter table public.tax_rule_version_legal_values
  add constraint tax_rule_version_legal_values_version_country_fk
  foreign key (tax_rule_version_id, country_code)
  references public.tax_rule_versions (id, country_code)
  on delete restrict;

alter table public.tax_rule_version_legal_values
  add constraint tax_rule_version_legal_values_legal_value_country_fk
  foreign key (legal_value_id, country_code)
  references public.country_legal_values (id, country_code)
  on delete restrict;

create unique index if not exists uq_tax_rule_version_legal_values_pair
  on public.tax_rule_version_legal_values (tax_rule_version_id, legal_value_id);

create index if not exists idx_tax_rule_version_legal_values_version
  on public.tax_rule_version_legal_values (tax_rule_version_id);

create index if not exists idx_tax_rule_version_legal_values_legal_value
  on public.tax_rule_version_legal_values (legal_value_id);

create index if not exists idx_tax_rule_version_legal_values_country
  on public.tax_rule_version_legal_values (country_code);

-- ==================================================
-- Country-scope messages (composite FKs are the hard guarantee)
-- ==================================================
create or replace function public.tax_knowledge_provenance_guard_country()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'tax_rule_version_sources' then
    if (
      select v.country_code
      from public.tax_rule_versions v
      where v.id = new.tax_rule_version_id
    ) is distinct from new.country_code
      or (
        select s.country_code
        from public.tax_sources s
        where s.id = new.tax_source_id
      ) is distinct from new.country_code
    then
      raise exception 'Cross-country tax provenance citation is forbidden';
    end if;
  elsif tg_table_name = 'tax_rule_version_legal_values' then
    if (
      select v.country_code
      from public.tax_rule_versions v
      where v.id = new.tax_rule_version_id
    ) is distinct from new.country_code
      or (
        select lv.country_code
        from public.country_legal_values lv
        where lv.id = new.legal_value_id
      ) is distinct from new.country_code
    then
      raise exception 'Cross-country tax legal-value binding is forbidden';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tax_rule_version_sources_country_guard
  on public.tax_rule_version_sources;
create trigger tax_rule_version_sources_country_guard
  before insert or update on public.tax_rule_version_sources
  for each row execute function public.tax_knowledge_provenance_guard_country();

drop trigger if exists tax_rule_version_legal_values_country_guard
  on public.tax_rule_version_legal_values;
create trigger tax_rule_version_legal_values_country_guard
  before insert or update on public.tax_rule_version_legal_values
  for each row execute function public.tax_knowledge_provenance_guard_country();

-- ==================================================
-- Parent-version lock: children mutable only while version is draft
-- ==================================================
create or replace function public.tax_knowledge_child_requires_parent_draft()
returns trigger
language plpgsql
as $$
declare
  old_status text;
  new_status text;
begin
  if tg_op = 'DELETE' then
    select v.status into old_status
    from public.tax_rule_versions v
    where v.id = old.tax_rule_version_id;
    if old_status is distinct from 'draft' then
      raise exception 'Tax knowledge provenance links are immutable after the parent version leaves draft';
    end if;
    return old;
  end if;

  select v.status into new_status
  from public.tax_rule_versions v
  where v.id = new.tax_rule_version_id;
  if new_status is distinct from 'draft' then
    raise exception 'Tax knowledge provenance links are immutable after the parent version leaves draft';
  end if;

  if tg_op = 'UPDATE' then
    select v.status into old_status
    from public.tax_rule_versions v
    where v.id = old.tax_rule_version_id;
    if old_status is distinct from 'draft' then
      raise exception 'Tax knowledge provenance links are immutable after the parent version leaves draft';
    end if;
    if old.created_at is distinct from new.created_at then
      raise exception '%.created_at is immutable', tg_table_name;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tax_rule_version_sources_parent_draft_guard
  on public.tax_rule_version_sources;
create trigger tax_rule_version_sources_parent_draft_guard
  before insert or update or delete on public.tax_rule_version_sources
  for each row execute function public.tax_knowledge_child_requires_parent_draft();

drop trigger if exists tax_rule_version_legal_values_parent_draft_guard
  on public.tax_rule_version_legal_values;
create trigger tax_rule_version_legal_values_parent_draft_guard
  before insert or update or delete on public.tax_rule_version_legal_values
  for each row execute function public.tax_knowledge_child_requires_parent_draft();

-- Truncate would wipe citations of active versions; always forbidden.
create or replace function public.tax_knowledge_provenance_forbid_truncate()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Hard delete is forbidden for tax knowledge table %. Use draft-only row delete before activation.', tg_table_name;
end;
$$;

drop trigger if exists tax_rule_version_sources_forbid_truncate
  on public.tax_rule_version_sources;
create trigger tax_rule_version_sources_forbid_truncate
  before truncate on public.tax_rule_version_sources
  execute function public.tax_knowledge_provenance_forbid_truncate();

drop trigger if exists tax_rule_version_legal_values_forbid_truncate
  on public.tax_rule_version_legal_values;
create trigger tax_rule_version_legal_values_forbid_truncate
  before truncate on public.tax_rule_version_legal_values
  execute function public.tax_knowledge_provenance_forbid_truncate();

-- ==================================================
-- RLS: platform canonical — same pattern as migration 600
-- ==================================================
alter table public.tax_rule_version_sources enable row level security;
alter table public.tax_rule_version_sources force row level security;
revoke all on table public.tax_rule_version_sources from anon, authenticated;

alter table public.tax_rule_version_legal_values enable row level security;
alter table public.tax_rule_version_legal_values force row level security;
revoke all on table public.tax_rule_version_legal_values from anon, authenticated;

-- No CREATE POLICY on purpose.
