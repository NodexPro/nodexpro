-- TAX-K1.2A — Tax Knowledge canonical publication guard.
-- Tax Brain reserved migration range: 600–699.
-- Scope: draft → active provenance check on tax_rule_versions only.
-- Does not alter migrations 600/601, Country Pack, legal values, commands, or UI.
-- Does not require official_law, legal-value bindings, or block later source retirement.

create or replace function public.tax_rule_versions_guard_publication_provenance()
returns trigger
language plpgsql
as $$
begin
  -- WHEN clause already limits this to draft → active; keep the predicate explicit.
  if old.status is distinct from 'draft' or new.status is distinct from 'active' then
    return new;
  end if;

  if not exists (
    select 1
    from public.tax_rule_version_sources citation
    join public.tax_sources src on src.id = citation.tax_source_id
    where citation.tax_rule_version_id = new.id
      and src.status = 'active'
  ) then
    raise exception
      'tax_rule_versions cannot activate without at least one citation to an active tax_source';
  end if;

  return new;
end;
$$;

comment on function public.tax_rule_versions_guard_publication_provenance() is
  'TAX-K1.2A: draft→active requires an exact-version citation whose tax_source.status is active. Does not inspect provenance_type. Does not require legal-value bindings. Does not block later source retirement.';

drop trigger if exists tax_rule_versions_publication_provenance_guard
  on public.tax_rule_versions;

create trigger tax_rule_versions_publication_provenance_guard
  before update on public.tax_rule_versions
  for each row
  when (old.status = 'draft' and new.status = 'active')
  execute function public.tax_rule_versions_guard_publication_provenance();
