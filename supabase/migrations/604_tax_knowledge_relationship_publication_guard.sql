-- TAX-K1.3A — Tax Knowledge relationship publication guard.
-- Tax Brain reserved migration range: 600–699.
-- Scope: draft → active check of direct outgoing blocking relationships only.
-- Does not alter migrations 600/601/602/603, Country Pack, legal values, commands, or UI.
-- Does not walk the graph, rewrite targets, or require active TO for conflicts_with / alternative_to.

create or replace function public.tax_rule_versions_guard_publication_relationships()
returns trigger
language plpgsql
as $$
begin
  -- WHEN clause already limits this to draft → active; keep the predicate explicit.
  if old.status is distinct from 'draft' or new.status is distinct from 'active' then
    return new;
  end if;

  if exists (
    select 1
    from public.tax_rule_relationships rel
    join public.tax_rule_versions dest on dest.id = rel.to_tax_rule_version_id
    where rel.from_tax_rule_version_id = new.id
      and rel.status = 'active'
      and rel.relationship_type in (
        'depends_on',
        'exception_to',
        'overrides',
        'special_case_of',
        'elaborates'
      )
      and dest.status is distinct from 'active'
  ) then
    raise exception
      'tax_rule_versions cannot activate while a blocking relationship points to a non-active tax_rule_version';
  end if;

  return new;
end;
$$;

comment on function public.tax_rule_versions_guard_publication_relationships() is
  'TAX-K1.3A: draft→active requires blocking outgoing relationships (depends_on, exception_to, overrides, special_case_of, elaborates) to point at an exact active TO version. conflicts_with and alternative_to do not block. Direct edges only. Does not rewrite historical targets after later TO retirement.';

drop trigger if exists tax_rule_versions_publication_relationships_guard
  on public.tax_rule_versions;

create trigger tax_rule_versions_publication_relationships_guard
  before update on public.tax_rule_versions
  for each row
  when (old.status = 'draft' and new.status = 'active')
  execute function public.tax_rule_versions_guard_publication_relationships();
