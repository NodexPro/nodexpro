-- TAX-K1.4F — Atomic tax rule version supersession.
-- Tax Brain reserved migration range: 600–699.
-- Scope: one SECURITY DEFINER RPC. Does not alter migrations 600–604.
-- Does not disable publication/immutability triggers. No latest-version lookup.
-- Not applied by this slice; backend service_role will call it after apply.

create or replace function public.tax_knowledge_supersede_tax_rule_version(
  p_new_tax_rule_version_id uuid,
  p_old_tax_rule_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new public.tax_rule_versions%rowtype;
  v_old public.tax_rule_versions%rowtype;
begin
  if p_new_tax_rule_version_id is null or p_old_tax_rule_version_id is null then
    raise exception 'new_tax_rule_version_id and old_tax_rule_version_id are required';
  end if;

  if p_new_tax_rule_version_id = p_old_tax_rule_version_id then
    raise exception 'new_tax_rule_version_id and old_tax_rule_version_id must be different';
  end if;

  -- Deterministic lock order. One transaction: later RAISE rolls back every UPDATE.
  perform 1
    from public.tax_rule_versions
    where id in (p_new_tax_rule_version_id, p_old_tax_rule_version_id)
    order by id
    for update;

  select * into v_new
    from public.tax_rule_versions
    where id = p_new_tax_rule_version_id;
  if not found then
    raise exception 'Tax rule version not found';
  end if;

  select * into v_old
    from public.tax_rule_versions
    where id = p_old_tax_rule_version_id;
  if not found then
    raise exception 'Tax rule version not found';
  end if;

  if v_new.status is distinct from 'draft' then
    raise exception 'supersede_tax_rule_version requires the NEW version to be draft';
  end if;

  if v_old.status is distinct from 'active' then
    raise exception 'supersede_tax_rule_version requires the OLD version to be active';
  end if;

  if v_new.tax_rule_id is distinct from v_old.tax_rule_id then
    raise exception 'NEW and OLD tax rule versions must belong to the same tax_rule';
  end if;

  if v_new.country_code is distinct from v_old.country_code then
    raise exception 'NEW and OLD tax rule versions must belong to the same country';
  end if;

  if v_new.supersedes_version_id is not null
    and v_new.supersedes_version_id is distinct from v_old.id
  then
    raise exception 'NEW.supersedes_version_id must be empty or exactly the OLD version';
  end if;

  -- OLD leaves active first so GiST overlap can admit NEW. Triggers stay enabled.
  update public.tax_rule_versions
    set
      status = 'superseded',
      superseded_by_version_id = v_new.id
    where id = v_old.id
      and status = 'active';
  if not found then
    raise exception 'supersede_tax_rule_version requires the OLD version to be active';
  end if;

  -- Lineage + draft→active in one row update while the trigger still sees OLD.status=draft.
  -- 602 provenance and 604 relationship publication guards fire on this UPDATE.
  update public.tax_rule_versions
    set
      supersedes_version_id = v_old.id,
      status = 'active'
    where id = v_new.id
      and status = 'draft';
  if not found then
    raise exception 'supersede_tax_rule_version requires the NEW version to be draft';
  end if;

  return jsonb_build_object(
    'old_tax_rule_version_id', v_old.id,
    'new_tax_rule_version_id', v_new.id,
    'tax_rule_id', v_new.tax_rule_id,
    'country_code', v_new.country_code,
    'old_status', 'superseded',
    'new_status', 'active'
  );
end;
$$;

comment on function public.tax_knowledge_supersede_tax_rule_version(uuid, uuid) is
  'TAX-K1.4F atomic supersession. Locks both versions, marks OLD active→superseded, then NEW draft→active with supersedes_version_id=OLD. One transaction. Does not disable 600/602/604 triggers. No latest-version fallback. service_role only.';

revoke all on function public.tax_knowledge_supersede_tax_rule_version(uuid, uuid) from public;
revoke all on function public.tax_knowledge_supersede_tax_rule_version(uuid, uuid) from anon, authenticated;
grant execute on function public.tax_knowledge_supersede_tax_rule_version(uuid, uuid) to service_role;
