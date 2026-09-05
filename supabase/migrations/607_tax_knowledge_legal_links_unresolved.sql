-- TAX-K3C — Legal links and unresolved legal references.
-- Tax Brain reserved migration range: 600–699.
-- Does not alter migration files 600–606 or 163.
-- Scope: extend relationship types, activation_critical, unresolved citations,
--        publication/activation guards, and a narrow FROM-active resolve RPC.

-- ==================================================
-- 1) Extend tax_rule_relationships
-- ==================================================
alter table public.tax_rule_relationships
  drop constraint if exists tax_rule_relationships_relationship_type_check;

alter table public.tax_rule_relationships
  add constraint tax_rule_relationships_relationship_type_check
  check (
    relationship_type in (
      'depends_on',
      'conflicts_with',
      'exception_to',
      'overrides',
      'alternative_to',
      'special_case_of',
      'elaborates',
      'applies_with',
      'calculation_basis',
      'procedural_requirement'
    )
  );

alter table public.tax_rule_relationships
  add column if not exists activation_critical boolean null;

alter table public.tax_rule_relationships
  add column if not exists origin_unresolved_legal_reference_id uuid null;

alter table public.tax_rule_relationships
  drop constraint if exists tax_rule_relationships_activation_critical_chk;

alter table public.tax_rule_relationships
  add constraint tax_rule_relationships_activation_critical_chk
  check (
    relationship_type = 'procedural_requirement'
    or activation_critical is null
  );

comment on column public.tax_rule_relationships.activation_critical is
  'Meaningful only for procedural_requirement. true=mandatory, false=guidance, null=unclassified. No implicit default.';

-- ==================================================
-- 2) tax_rule_unresolved_legal_references
-- ==================================================
create table if not exists public.tax_rule_unresolved_legal_references (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null,
  from_tax_rule_version_id uuid not null,
  relationship_intent text not null check (
    relationship_intent in (
      'depends_on',
      'conflicts_with',
      'exception_to',
      'overrides',
      'alternative_to',
      'special_case_of',
      'elaborates',
      'applies_with',
      'calculation_basis',
      'procedural_requirement'
    )
  ),
  activation_critical boolean null,
  cited_title text null,
  cited_law_name text null,
  cited_instrument_kind text not null check (
    cited_instrument_kind in ('law', 'section', 'regulation', 'instruction', 'order', 'other')
  ),
  cited_provision_number text null,
  locator_text text not null,
  source_tax_source_id uuid null,
  source_locator text null,
  status text not null check (status in ('draft', 'open', 'resolved', 'discarded')),
  resolved_to_tax_rule_version_id uuid null,
  resolved_relationship_id uuid null,
  owner_note text null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  discarded_at timestamptz null,
  discarded_reason text null,
  check (btrim(locator_text) <> ''),
  check (source_locator is null or btrim(source_locator) <> ''),
  check (cited_title is null or btrim(cited_title) <> ''),
  check (cited_law_name is null or btrim(cited_law_name) <> ''),
  check (cited_provision_number is null or btrim(cited_provision_number) <> ''),
  check (
    relationship_intent = 'procedural_requirement'
    or activation_critical is null
  ),
  constraint tax_rule_unresolved_open_procedural_activation_critical_chk check (
    status <> 'open'
    or relationship_intent <> 'procedural_requirement'
    or activation_critical is not null
  ),
  check (
    resolved_to_tax_rule_version_id is null
    or resolved_to_tax_rule_version_id <> from_tax_rule_version_id
  )
);

comment on table public.tax_rule_unresolved_legal_references is
  'TAX-K3C structured citations to legal material not yet loaded. No stub tax_rule. No organization_id. Same-country only.';

alter table public.tax_rule_unresolved_legal_references
  add constraint tax_rule_unresolved_from_version_country_fk
  foreign key (from_tax_rule_version_id, country_code)
  references public.tax_rule_versions (id, country_code)
  on delete restrict;

alter table public.tax_rule_unresolved_legal_references
  add constraint tax_rule_unresolved_source_country_fk
  foreign key (source_tax_source_id, country_code)
  references public.tax_sources (id, country_code)
  on delete restrict;

alter table public.tax_rule_unresolved_legal_references
  add constraint tax_rule_unresolved_resolved_to_country_fk
  foreign key (resolved_to_tax_rule_version_id, country_code)
  references public.tax_rule_versions (id, country_code)
  on delete restrict;

create unique index if not exists uq_tax_rule_unresolved_identity
  on public.tax_rule_unresolved_legal_references (
    from_tax_rule_version_id,
    relationship_intent,
    locator_text
  );

create index if not exists idx_tax_rule_unresolved_from
  on public.tax_rule_unresolved_legal_references (from_tax_rule_version_id);

create index if not exists idx_tax_rule_unresolved_country
  on public.tax_rule_unresolved_legal_references (country_code);

create index if not exists idx_tax_rule_unresolved_status
  on public.tax_rule_unresolved_legal_references (status);

alter table public.tax_rule_relationships
  add constraint tax_rule_relationships_origin_unresolved_fk
  foreign key (origin_unresolved_legal_reference_id)
  references public.tax_rule_unresolved_legal_references (id)
  on delete restrict;

alter table public.tax_rule_relationships
  drop constraint if exists tax_rule_relationships_origin_unresolved_uidq;

alter table public.tax_rule_relationships
  add constraint tax_rule_relationships_origin_unresolved_uidq
  unique (origin_unresolved_legal_reference_id);

alter table public.tax_rule_unresolved_legal_references
  drop constraint if exists tax_rule_unresolved_open_procedural_activation_critical_chk;

alter table public.tax_rule_unresolved_legal_references
  add constraint tax_rule_unresolved_open_procedural_activation_critical_chk
  check (
    status <> 'open'
    or relationship_intent <> 'procedural_requirement'
    or activation_critical is not null
  );

alter table public.tax_rule_unresolved_legal_references
  add constraint tax_rule_unresolved_resolved_relationship_fk
  foreign key (resolved_relationship_id)
  references public.tax_rule_relationships (id)
  on delete restrict;

-- ==================================================
-- 3) Country / lifecycle guards
-- ==================================================
create or replace function public.tax_knowledge_unresolved_guard_country()
returns trigger
language plpgsql
as $$
begin
  if (
    select v.country_code
    from public.tax_rule_versions v
    where v.id = new.from_tax_rule_version_id
  ) is distinct from new.country_code
  then
    raise exception 'Cross-country unresolved legal reference is forbidden';
  end if;

  if new.source_tax_source_id is not null
    and (
      select s.country_code
      from public.tax_sources s
      where s.id = new.source_tax_source_id
    ) is distinct from new.country_code
  then
    raise exception 'Cross-country unresolved legal reference is forbidden';
  end if;

  if new.resolved_to_tax_rule_version_id is not null
    and (
      select v.country_code
      from public.tax_rule_versions v
      where v.id = new.resolved_to_tax_rule_version_id
    ) is distinct from new.country_code
  then
    raise exception 'Cross-country unresolved legal reference is forbidden';
  end if;

  return new;
end;
$$;

drop trigger if exists tax_rule_unresolved_country_guard
  on public.tax_rule_unresolved_legal_references;
create trigger tax_rule_unresolved_country_guard
  before insert or update on public.tax_rule_unresolved_legal_references
  for each row execute function public.tax_knowledge_unresolved_guard_country();

create or replace function public.tax_knowledge_unresolved_guard_lifecycle()
returns trigger
language plpgsql
as $$
declare
  from_status text;
begin
  select v.status into from_status
  from public.tax_rule_versions v
  where v.id = coalesce(new.from_tax_rule_version_id, old.from_tax_rule_version_id);

  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'open') then
      raise exception 'unresolved legal references must be inserted as draft or open';
    end if;
    if from_status is distinct from 'draft' then
      raise exception 'unresolved legal references are mutable only while the FROM version is draft';
    end if;
    if new.resolved_to_tax_rule_version_id is not null
      or new.resolved_relationship_id is not null
      or new.resolved_at is not null
      or new.discarded_at is not null
    then
      raise exception 'unresolved legal reference resolution fields cannot be set on insert';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if from_status is distinct from 'draft' then
      raise exception 'unresolved legal references are immutable after the FROM version leaves draft';
    end if;
    return old;
  end if;

  if old.created_at is distinct from new.created_at then
    raise exception 'tax_rule_unresolved_legal_references.created_at is immutable';
  end if;
  if old.from_tax_rule_version_id is distinct from new.from_tax_rule_version_id
    or old.country_code is distinct from new.country_code
  then
    raise exception 'unresolved legal reference FROM identity is immutable';
  end if;

  if from_status is distinct from 'draft' then
    if old.status = 'open' and new.status = 'resolved' then
      if old.relationship_intent is distinct from new.relationship_intent
        or old.locator_text is distinct from new.locator_text
        or old.cited_title is distinct from new.cited_title
        or old.cited_law_name is distinct from new.cited_law_name
        or old.cited_instrument_kind is distinct from new.cited_instrument_kind
        or old.cited_provision_number is distinct from new.cited_provision_number
        or old.source_tax_source_id is distinct from new.source_tax_source_id
        or old.source_locator is distinct from new.source_locator
        or old.activation_critical is distinct from new.activation_critical
      then
        raise exception 'unresolved legal reference citation fields are frozen after the FROM version leaves draft';
      end if;
      return new;
    end if;
    if old.status = 'open' and new.status = 'discarded' then
      if old.relationship_intent is distinct from new.relationship_intent
        or old.locator_text is distinct from new.locator_text
        or old.cited_title is distinct from new.cited_title
        or old.cited_law_name is distinct from new.cited_law_name
        or old.cited_instrument_kind is distinct from new.cited_instrument_kind
        or old.cited_provision_number is distinct from new.cited_provision_number
        or old.source_tax_source_id is distinct from new.source_tax_source_id
        or old.source_locator is distinct from new.source_locator
        or old.activation_critical is distinct from new.activation_critical
      then
        raise exception 'unresolved legal reference citation fields are frozen after the FROM version leaves draft';
      end if;
      return new;
    end if;
    raise exception 'unresolved legal references are immutable after the FROM version leaves draft';
  end if;

  if old.status = 'draft' and new.status in ('open', 'discarded') then
    return new;
  end if;
  if old.status = 'open' and new.status in ('resolved', 'discarded') then
    return new;
  end if;
  if old.status = new.status and old.status in ('draft', 'open') then
    return new;
  end if;
  if old.status in ('resolved', 'discarded') then
    raise exception 'resolved or discarded unresolved legal references are terminal';
  end if;
  raise exception 'invalid unresolved legal reference status transition';
end;
$$;

drop trigger if exists tax_rule_unresolved_lifecycle_guard
  on public.tax_rule_unresolved_legal_references;
create trigger tax_rule_unresolved_lifecycle_guard
  before insert or update or delete on public.tax_rule_unresolved_legal_references
  for each row execute function public.tax_knowledge_unresolved_guard_lifecycle();

drop trigger if exists tax_rule_unresolved_forbid_truncate
  on public.tax_rule_unresolved_legal_references;
create trigger tax_rule_unresolved_forbid_truncate
  before truncate on public.tax_rule_unresolved_legal_references
  execute function public.tax_knowledge_provenance_forbid_truncate();

-- ==================================================
-- 4) Resolved-edge publication: keep K1.3A + three new types
-- ==================================================
create or replace function public.tax_rule_versions_guard_publication_relationships()
returns trigger
language plpgsql
as $$
begin
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
        'elaborates',
        'applies_with',
        'calculation_basis',
        'procedural_requirement'
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
  'TAX-K1.3A + K3C: draft→active requires blocking outgoing relationships including applies_with, calculation_basis, procedural_requirement to point at an exact active TO version. conflicts_with and alternative_to do not block.';

-- ==================================================
-- 5) Unresolved activation guard
-- ==================================================
create or replace function public.tax_rule_versions_guard_publication_unresolved()
returns trigger
language plpgsql
as $$
begin
  if old.status is distinct from 'draft' or new.status is distinct from 'active' then
    return new;
  end if;

  if exists (
    select 1
    from public.tax_rule_unresolved_legal_references u
    where u.from_tax_rule_version_id = new.id
      and u.status = 'draft'
  ) then
    raise exception 'TAX_KNOWLEDGE_UNRESOLVED_REFERENCE_BLOCKS_ACTIVATION';
  end if;

  if exists (
    select 1
    from public.tax_rule_unresolved_legal_references u
    where u.from_tax_rule_version_id = new.id
      and u.status = 'open'
      and (
        u.relationship_intent in (
          'depends_on',
          'exception_to',
          'overrides',
          'applies_with',
          'calculation_basis'
        )
        or (
          u.relationship_intent = 'procedural_requirement'
          and u.activation_critical is distinct from false
        )
      )
  ) then
    raise exception 'TAX_KNOWLEDGE_UNRESOLVED_REFERENCE_BLOCKS_ACTIVATION';
  end if;

  return new;
end;
$$;

drop trigger if exists tax_rule_versions_publication_unresolved_guard
  on public.tax_rule_versions;
create trigger tax_rule_versions_publication_unresolved_guard
  before update on public.tax_rule_versions
  for each row
  when (old.status = 'draft' and new.status = 'active')
  execute function public.tax_rule_versions_guard_publication_unresolved();

-- ==================================================
-- 6) Narrow FROM-active resolve exception + RPC
-- ==================================================
create or replace function public.tax_knowledge_relationship_requires_from_draft()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  old_status text;
  new_status text;
  resolve_owner name;
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
    -- FROM-active INSERT is allowed only inside the SECURITY DEFINER resolve RPC.
    -- Identity is the function owner via current_user; no GUC / session flag / caller marker.
    if tg_op = 'INSERT'
      and current_user is distinct from session_user
      and new.origin_unresolved_legal_reference_id is not null
    then
      select pg_catalog.pg_get_userbyid(p.proowner)
        into resolve_owner
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'tax_knowledge_resolve_unresolved_legal_reference'
          and p.prosecdef
        limit 1;
      if resolve_owner is not null
        and current_user = resolve_owner
        and exists (
          select 1
          from public.tax_rule_unresolved_legal_references u
          where u.id = new.origin_unresolved_legal_reference_id
            and u.status = 'open'
            and u.from_tax_rule_version_id = new.from_tax_rule_version_id
            and u.country_code = new.country_code
            and u.relationship_intent = new.relationship_type
            and u.activation_critical is not distinct from new.activation_critical
        )
      then
        return new;
      end if;
    end if;
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

create or replace function public.tax_knowledge_resolve_unresolved_legal_reference(
  p_unresolved_id uuid,
  p_to_tax_rule_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ref public.tax_rule_unresolved_legal_references%rowtype;
  v_to public.tax_rule_versions%rowtype;
  v_rel_id uuid;
begin
  if p_unresolved_id is null or p_to_tax_rule_version_id is null then
    raise exception 'unresolved legal reference id and to_tax_rule_version_id are required';
  end if;

  select * into v_ref
    from public.tax_rule_unresolved_legal_references
    where id = p_unresolved_id
    for update;
  if not found then
    raise exception 'Unresolved legal reference not found';
  end if;
  if v_ref.status is distinct from 'open' then
    raise exception 'Unresolved legal reference must be open to resolve';
  end if;

  select * into v_to
    from public.tax_rule_versions
    where id = p_to_tax_rule_version_id
    for update;
  if not found then
    raise exception 'Tax rule version not found';
  end if;
  if v_to.country_code is distinct from v_ref.country_code then
    raise exception 'Resolved tax rule version must belong to the same country';
  end if;
  if v_to.status is distinct from 'active' then
    raise exception 'Resolved tax rule version must be active';
  end if;
  if v_to.id = v_ref.from_tax_rule_version_id then
    raise exception 'Resolved tax rule version must be different from the FROM version';
  end if;

  insert into public.tax_rule_relationships (
    country_code,
    from_tax_rule_version_id,
    to_tax_rule_version_id,
    relationship_type,
    status,
    activation_critical,
    origin_unresolved_legal_reference_id
  ) values (
    v_ref.country_code,
    v_ref.from_tax_rule_version_id,
    v_to.id,
    v_ref.relationship_intent,
    'active',
    v_ref.activation_critical,
    v_ref.id
  )
  returning id into v_rel_id;

  update public.tax_rule_unresolved_legal_references
    set
      status = 'resolved',
      resolved_to_tax_rule_version_id = v_to.id,
      resolved_relationship_id = v_rel_id,
      resolved_at = now()
    where id = v_ref.id
      and status = 'open';
  if not found then
    raise exception 'Unresolved legal reference must be open to resolve';
  end if;

  return jsonb_build_object(
    'unresolved_legal_reference_id', v_ref.id,
    'tax_rule_relationship_id', v_rel_id,
    'to_tax_rule_version_id', v_to.id
  );
end;
$$;

revoke all on function public.tax_knowledge_resolve_unresolved_legal_reference(uuid, uuid) from public;
revoke all on function public.tax_knowledge_resolve_unresolved_legal_reference(uuid, uuid) from anon, authenticated;
grant execute on function public.tax_knowledge_resolve_unresolved_legal_reference(uuid, uuid) to service_role;

-- ==================================================
-- 7) RLS + privileges
-- ==================================================
alter table public.tax_rule_unresolved_legal_references enable row level security;
alter table public.tax_rule_unresolved_legal_references force row level security;
revoke all on table public.tax_rule_unresolved_legal_references from anon, authenticated;
grant select, insert, update, delete on table public.tax_rule_unresolved_legal_references to service_role;
