-- TAX-623 — Legal Value VERSION legal authorities.
-- Tax Brain reserved migration range: 600–699.
-- DEV-only apply: Supabase project jgxezhjctrgfbmmkqqhn / branch develop.
-- Do not apply to production.
--
-- Ownership unchanged:
--   country_legal_values = Legal Value identity (Country Pack)
--   country_legal_value_versions = Legal Value version (Country Pack)
--
-- This table is LEGAL AUTHORITY for a value version:
--   this Legal Value VERSION is justified by this Tax Rule VERSION.
--
-- It is NOT consumption. Existing tax_rule_version_legal_values remains
-- "this rule version uses this legal value identity" and must not be reused
-- as authority / provenance.
--
-- Pins tax_rule_version_id (versioned legal truth), not mutable titles,
-- category, module_scope, usage_hint, or citation text.
-- Multiple authorities per value version are allowed.
-- Insert/delete only while the Legal Value version is draft.
-- Historical pins survive later rule supersession (ON DELETE RESTRICT).
--
-- Knowledge Trainer may later insert DRAFT pins only. This migration
-- never auto-activates or extracts from uploads.
-- Does not seed Israeli laws or Legal Values.

create table if not exists public.country_legal_value_version_authorities (
  id uuid primary key default gen_random_uuid(),
  country_legal_value_version_id uuid not null
    references public.country_legal_value_versions (id) on delete restrict,
  country_code char(2) not null references public.countries (code) on delete restrict,
  tax_rule_version_id uuid not null,
  created_at timestamptz not null default now()
);

comment on table public.country_legal_value_version_authorities is
  'TAX-623 legal authority for a Legal Value VERSION. Pins tax_rule_version_id. Distinct from tax_rule_version_legal_values (rule uses value identity).';

alter table public.country_legal_value_version_authorities
  add constraint country_legal_value_version_authorities_rule_version_country_fk
  foreign key (tax_rule_version_id, country_code)
  references public.tax_rule_versions (id, country_code)
  on delete restrict;

create unique index if not exists uq_clv_version_authorities_pair
  on public.country_legal_value_version_authorities (
    country_legal_value_version_id,
    tax_rule_version_id
  );

create index if not exists idx_clv_version_authorities_version
  on public.country_legal_value_version_authorities (country_legal_value_version_id);

create index if not exists idx_clv_version_authorities_rule_version
  on public.country_legal_value_version_authorities (tax_rule_version_id);

create index if not exists idx_clv_version_authorities_country
  on public.country_legal_value_version_authorities (country_code);

create or replace function public.country_legal_value_version_authorities_guard()
returns trigger
language plpgsql
as $$
declare
  value_country char(2);
  version_status text;
begin
  select lv.country_code
    into value_country
  from public.country_legal_value_versions ver
  join public.country_legal_values lv on lv.id = ver.legal_value_id
  where ver.id = new.country_legal_value_version_id;

  if value_country is null then
    raise exception 'Legal value version not found for authority pin';
  end if;

  if value_country <> new.country_code then
    raise exception 'country_legal_value_version_authorities country mismatch';
  end if;

  select ver.status
    into version_status
  from public.country_legal_value_versions ver
  where ver.id = new.country_legal_value_version_id;

  if version_status <> 'draft' then
    raise exception 'Legal authority pins can be added only on draft legal value versions';
  end if;

  return new;
end;
$$;

create or replace function public.country_legal_value_version_authorities_guard_delete()
returns trigger
language plpgsql
as $$
declare
  version_status text;
begin
  select ver.status
    into version_status
  from public.country_legal_value_versions ver
  where ver.id = old.country_legal_value_version_id;

  if version_status is not null and version_status <> 'draft' then
    raise exception 'Legal authority pins can be removed only from draft legal value versions';
  end if;

  return old;
end;
$$;

drop trigger if exists country_legal_value_version_authorities_guard
  on public.country_legal_value_version_authorities;
create trigger country_legal_value_version_authorities_guard
  before insert or update on public.country_legal_value_version_authorities
  for each row execute function public.country_legal_value_version_authorities_guard();

drop trigger if exists country_legal_value_version_authorities_guard_delete
  on public.country_legal_value_version_authorities;
create trigger country_legal_value_version_authorities_guard_delete
  before delete on public.country_legal_value_version_authorities
  for each row execute function public.country_legal_value_version_authorities_guard_delete();

create or replace function public.country_legal_value_version_authorities_forbid_truncate()
returns trigger
language plpgsql
as $$
begin
  raise exception 'TRUNCATE is forbidden on country_legal_value_version_authorities';
end;
$$;

drop trigger if exists country_legal_value_version_authorities_forbid_truncate
  on public.country_legal_value_version_authorities;
create trigger country_legal_value_version_authorities_forbid_truncate
  before truncate on public.country_legal_value_version_authorities
  execute function public.country_legal_value_version_authorities_forbid_truncate();

-- Historical Legal Value versions keep their payload after activation.
-- Activate/deactivate and closing effective_to remain allowed.
create or replace function public.country_legal_value_versions_forbid_historical_overwrite()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'draft' then
    if new.value_payload_json is distinct from old.value_payload_json then
      raise exception 'Active or historical legal value versions cannot overwrite value_payload_json';
    end if;
    if new.effective_from is distinct from old.effective_from then
      raise exception 'Active or historical legal value versions cannot overwrite effective_from';
    end if;
    if new.country_pack_ruleset_id is distinct from old.country_pack_ruleset_id then
      raise exception 'Active or historical legal value versions cannot overwrite country_pack_ruleset_id';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists country_legal_value_versions_forbid_historical_overwrite
  on public.country_legal_value_versions;
create trigger country_legal_value_versions_forbid_historical_overwrite
  before update on public.country_legal_value_versions
  for each row execute function public.country_legal_value_versions_forbid_historical_overwrite();

grant execute on function public.country_legal_value_versions_forbid_historical_overwrite() to service_role;

alter table public.country_legal_value_version_authorities enable row level security;
alter table public.country_legal_value_version_authorities force row level security;
revoke all on table public.country_legal_value_version_authorities from public, anon, authenticated;
grant select, insert, delete on table public.country_legal_value_version_authorities to service_role;
grant execute on function public.country_legal_value_version_authorities_guard() to service_role;
grant execute on function public.country_legal_value_version_authorities_guard_delete() to service_role;
grant execute on function public.country_legal_value_version_authorities_forbid_truncate() to service_role;
