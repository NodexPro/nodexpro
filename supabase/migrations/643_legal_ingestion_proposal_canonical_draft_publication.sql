-- TAX-648C — Multi-object B2 → Canonical DRAFT publication map + atomic RPC foundation.
-- Tax Brain reserved migration range: 600–699.
-- Next unused 6xx after 642.
-- DEV-only apply: Supabase project jgxezhjctrgfbmmkqqhn / branch develop.
-- Do not apply to production.
--
-- ADDITIVE ONLY. Does not drop or rewrite 600–642 objects.
-- Does not add the Owner publish command or UI.
-- Does not activate law. Does not write K4 calculation tables.
-- Does not create Fact Dictionary definitions or Country Legal Values.
--
-- Edge idempotency is owned by existing unique indexes (do not duplicate in this map):
--   uq_tax_rule_legal_nodes_pair
--   uq_tax_rule_version_sources_citation
--   uq_tax_rule_version_legal_values_pair
--   uq_tax_rule_relationships_edge
--   uq_tax_rule_unresolved_identity
-- The map stores only identity objects that later 648B must resolve on retry:
--   legal_node / rule / rule_version.
--
-- TypeScript-only invariants stay in the future 648B command layer:
--   TAX-639 / K3 predicate parse, generateLegalMachineCode, taxRulePayloadChecksum,
--   legal identifier parse, pack/ruleset selection.
-- This RPC is the atomic writer for a service_role plan. It is not a public canonical writer.

create table if not exists public.legal_ingestion_tax_knowledge_proposal_publications (
  id uuid primary key default gen_random_uuid(),
  tax_knowledge_proposal_id uuid not null,
  country_code char(2) not null references public.countries(code) on delete restrict,
  local_kind text not null check (local_kind in ('legal_node', 'rule', 'rule_version')),
  local_key text not null,
  canonical_object_type text not null check (
    canonical_object_type in ('tax_legal_node', 'tax_rule', 'tax_rule_version')
  ),
  canonical_object_id uuid not null,
  created_at timestamptz not null default now(),
  check (btrim(local_key) <> ''),
  check (
    (local_kind = 'legal_node' and canonical_object_type = 'tax_legal_node')
    or (local_kind = 'rule' and canonical_object_type = 'tax_rule')
    or (local_kind = 'rule_version' and canonical_object_type = 'tax_rule_version')
  )
);

comment on table public.legal_ingestion_tax_knowledge_proposal_publications is
  'TAX-648C durable B2 local_key → canonical DRAFT identity map. Not a second Tax Knowledge graph. Not activation.';

comment on column public.legal_ingestion_tax_knowledge_proposal_publications.local_key is
  'B2 proposal_node_key / proposal_rule_key. rule_version uses the same proposal_rule_key.';

create unique index if not exists uq_legal_ingestion_proposal_publications_local
  on public.legal_ingestion_tax_knowledge_proposal_publications (
    tax_knowledge_proposal_id,
    local_kind,
    local_key
  );

create unique index if not exists uq_legal_ingestion_proposal_publications_canonical
  on public.legal_ingestion_tax_knowledge_proposal_publications (
    tax_knowledge_proposal_id,
    canonical_object_type,
    canonical_object_id
  );

create index if not exists idx_legal_ingestion_proposal_publications_proposal
  on public.legal_ingestion_tax_knowledge_proposal_publications (tax_knowledge_proposal_id, country_code);

alter table public.legal_ingestion_tax_knowledge_proposal_publications
  drop constraint if exists legal_ingestion_proposal_publications_proposal_country_fk;
alter table public.legal_ingestion_tax_knowledge_proposal_publications
  add constraint legal_ingestion_proposal_publications_proposal_country_fk
  foreign key (tax_knowledge_proposal_id, country_code)
  references public.legal_ingestion_tax_knowledge_proposals (id, country_code)
  on delete restrict;

create or replace function public.legal_ingestion_proposal_publications_guard_canonical()
returns trigger
language plpgsql
as $$
declare
  v_country char(2);
  v_status text;
begin
  if new.canonical_object_type = 'tax_legal_node' then
    select n.country_code, n.status into v_country, v_status
    from public.tax_legal_nodes n
    where n.id = new.canonical_object_id;
    if v_country is null then
      raise exception 'publication map legal_node must reference an existing tax_legal_node';
    end if;
  elsif new.canonical_object_type = 'tax_rule' then
    select r.country_code, r.status into v_country, v_status
    from public.tax_rules r
    where r.id = new.canonical_object_id;
    if v_country is null then
      raise exception 'publication map rule must reference an existing tax_rule';
    end if;
  else
    select v.country_code, v.status into v_country, v_status
    from public.tax_rule_versions v
    where v.id = new.canonical_object_id;
    if v_country is null then
      raise exception 'publication map rule_version must reference an existing tax_rule_version';
    end if;
    if v_status is distinct from 'draft' then
      raise exception 'publication map can only record a draft tax_rule_version, never active';
    end if;
  end if;
  if v_country is distinct from new.country_code then
    raise exception 'publication map canonical object must belong to the proposal country';
  end if;
  return new;
end;
$$;

drop trigger if exists legal_ingestion_proposal_publications_guard_canonical
  on public.legal_ingestion_tax_knowledge_proposal_publications;
create trigger legal_ingestion_proposal_publications_guard_canonical
  before insert or update on public.legal_ingestion_tax_knowledge_proposal_publications
  for each row execute function public.legal_ingestion_proposal_publications_guard_canonical();

create or replace function public.legal_ingestion_proposal_publications_forbid_mutate()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Hard delete is forbidden for legal_ingestion_tax_knowledge_proposal_publications';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'legal_ingestion_tax_knowledge_proposal_publications rows are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists legal_ingestion_proposal_publications_forbid_update
  on public.legal_ingestion_tax_knowledge_proposal_publications;
create trigger legal_ingestion_proposal_publications_forbid_update
  before update on public.legal_ingestion_tax_knowledge_proposal_publications
  for each row execute function public.legal_ingestion_proposal_publications_forbid_mutate();

drop trigger if exists legal_ingestion_proposal_publications_forbid_delete
  on public.legal_ingestion_tax_knowledge_proposal_publications;
create trigger legal_ingestion_proposal_publications_forbid_delete
  before delete on public.legal_ingestion_tax_knowledge_proposal_publications
  for each row execute function public.legal_ingestion_proposal_publications_forbid_mutate();

alter table public.legal_ingestion_tax_knowledge_proposal_publications enable row level security;
alter table public.legal_ingestion_tax_knowledge_proposal_publications force row level security;

revoke all on table public.legal_ingestion_tax_knowledge_proposal_publications from anon, authenticated, public;
grant select, insert on table public.legal_ingestion_tax_knowledge_proposal_publications to service_role;

create or replace function public.legal_ingestion_jsonb_has_forbidden_statutory_key(value jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  v_key text;
  v_elem jsonb;
begin
  if value is null then
    return false;
  end if;
  if jsonb_typeof(value) = 'object' then
    for v_key in select jsonb_object_keys(value)
    loop
      if v_key in ('rate', 'amount', 'threshold', 'legal_value_version_id') then
        return true;
      end if;
      if public.legal_ingestion_jsonb_has_forbidden_statutory_key(value -> v_key) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(value) = 'array' then
    for v_elem in select jsonb_array_elements(value)
    loop
      if public.legal_ingestion_jsonb_has_forbidden_statutory_key(v_elem) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$$;

create or replace function public.legal_ingestion_publication_map_put(
  p_proposal_id uuid,
  p_country_code text,
  p_local_kind text,
  p_local_key text,
  p_canonical_object_type text,
  p_canonical_object_id uuid
)
returns void
language plpgsql
as $$
declare
  v_existing uuid;
begin
  if p_local_key is null or btrim(p_local_key) = '' then
    raise exception 'publication map local_key is required';
  end if;
  select p.canonical_object_id
    into v_existing
  from public.legal_ingestion_tax_knowledge_proposal_publications p
  where p.tax_knowledge_proposal_id = p_proposal_id
    and p.local_kind = p_local_kind
    and p.local_key = p_local_key;
  if v_existing is not null then
    if v_existing is distinct from p_canonical_object_id then
      raise exception 'publication map local_key % already maps to a different canonical object', p_local_key;
    end if;
    return;
  end if;
  insert into public.legal_ingestion_tax_knowledge_proposal_publications (
    tax_knowledge_proposal_id,
    country_code,
    local_kind,
    local_key,
    canonical_object_type,
    canonical_object_id
  ) values (
    p_proposal_id,
    p_country_code,
    p_local_kind,
    p_local_key,
    p_canonical_object_type,
    p_canonical_object_id
  );
end;
$$;

create or replace function public.legal_ingestion_publication_mapped_id(
  p_proposal_id uuid,
  p_local_kind text,
  p_local_key text
)
returns uuid
language plpgsql
stable
as $$
declare
  v_id uuid;
begin
  select p.canonical_object_id
    into v_id
  from public.legal_ingestion_tax_knowledge_proposal_publications p
  where p.tax_knowledge_proposal_id = p_proposal_id
    and p.local_kind = p_local_kind
    and p.local_key = p_local_key;
  return v_id;
end;
$$;

create or replace function public.legal_ingestion_apply_tax_knowledge_proposal_canonical_draft_publication(
  p_tax_knowledge_proposal_id uuid,
  p_actor_user_id uuid,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.legal_ingestion_tax_knowledge_proposals%rowtype;
  v_node jsonb;
  v_rule jsonb;
  v_rel jsonb;
  v_unresolved jsonb;
  v_pin jsonb;
  v_value_id uuid;
  v_node_id uuid;
  v_parent_id uuid;
  v_rule_id uuid;
  v_version_id uuid;
  v_from_id uuid;
  v_to_id uuid;
  v_source_id uuid;
  v_text text;
  v_kind_country char(2);
  v_existing_country char(2);
  v_existing_source uuid;
  v_existing_status text;
  v_pack_country char(2);
  v_ruleset_pack uuid;
  v_next_version integer;
  v_payload jsonb;
  v_checksum text;
  v_first_node uuid;
  v_first_rule uuid;
  v_first_version uuid;
  v_publications jsonb;
begin
  if p_tax_knowledge_proposal_id is null then
    raise exception 'tax_knowledge_proposal_id is required';
  end if;
  if p_plan is null or jsonb_typeof(p_plan) is distinct from 'object' then
    raise exception 'publication plan must be a JSON object';
  end if;
  if p_plan ? 'calculations' or p_plan ? 'calculation_keys' then
    raise exception 'TAX-648C does not publish K4 calculations';
  end if;

  perform 1
  from public.legal_ingestion_tax_knowledge_proposals
  where id = p_tax_knowledge_proposal_id
  for update;
  if not found then
    raise exception 'Tax knowledge proposal not found';
  end if;

  select * into v_proposal
  from public.legal_ingestion_tax_knowledge_proposals
  where id = p_tax_knowledge_proposal_id;

  if v_proposal.status = 'published_to_canonical_draft' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'local_kind', p.local_kind,
      'local_key', p.local_key,
      'canonical_object_type', p.canonical_object_type,
      'canonical_object_id', p.canonical_object_id
    ) order by p.created_at, p.local_kind, p.local_key), '[]'::jsonb)
      into v_publications
    from public.legal_ingestion_tax_knowledge_proposal_publications p
    where p.tax_knowledge_proposal_id = v_proposal.id;
    return jsonb_build_object(
      'already_published', true,
      'tax_knowledge_proposal_id', v_proposal.id,
      'country_code', v_proposal.country_code,
      'status', v_proposal.status,
      'published_tax_rule_id', v_proposal.published_tax_rule_id,
      'published_tax_rule_version_id', v_proposal.published_tax_rule_version_id,
      'published_tax_legal_node_id', v_proposal.published_tax_legal_node_id,
      'publications', v_publications
    );
  end if;

  if v_proposal.status is distinct from 'owner_approved' then
    raise exception 'proposal may be published_to_canonical_draft only from owner_approved';
  end if;

  if coalesce(p_plan ->> 'country_code', v_proposal.country_code) is distinct from v_proposal.country_code then
    raise exception 'publication plan country_code must match the proposal';
  end if;

  if p_plan ? 'country_pack_id' then
    select cp.country_code into v_pack_country
    from public.country_packs cp
    where cp.id = (p_plan ->> 'country_pack_id')::uuid;
    if v_pack_country is distinct from v_proposal.country_code then
      raise exception 'country_pack_id must belong to the proposal country';
    end if;
  end if;
  if p_plan ? 'country_pack_ruleset_id' then
    select rs.country_pack_id into v_ruleset_pack
    from public.country_pack_rulesets rs
    where rs.id = (p_plan ->> 'country_pack_ruleset_id')::uuid;
    if v_ruleset_pack is distinct from (p_plan ->> 'country_pack_id')::uuid then
      raise exception 'country_pack_ruleset_id must belong to the plan country_pack_id';
    end if;
  end if;

  for v_node in
    select value
    from jsonb_array_elements(coalesce(p_plan -> 'nodes', '[]'::jsonb))
  loop
    if coalesce(v_node ->> 'local_key', '') = '' then
      raise exception 'node local_key is required';
    end if;
    v_parent_id := null;
    if coalesce(v_node ->> 'parent_local_key', '') <> '' then
      v_parent_id := public.legal_ingestion_publication_mapped_id(
        v_proposal.id, 'legal_node', v_node ->> 'parent_local_key'
      );
      if v_parent_id is null then
        raise exception 'parent node % must be published before child %',
          v_node ->> 'parent_local_key', v_node ->> 'local_key';
      end if;
    end if;
    if coalesce(v_node ->> 'parent_tax_legal_node_id', '') <> '' then
      select n.id, n.country_code, n.tax_source_id
        into v_node_id, v_existing_country, v_existing_source
      from public.tax_legal_nodes n
      where n.id = (v_node ->> 'parent_tax_legal_node_id')::uuid;
      if v_node_id is null then
        raise exception 'parent_tax_legal_node_id not found';
      end if;
      if v_existing_country is distinct from v_proposal.country_code
        or v_existing_source is distinct from v_proposal.tax_source_id then
        raise exception 'parent_tax_legal_node_id must belong to the proposal country and tax_source';
      end if;
      if v_parent_id is not null and v_parent_id is distinct from v_node_id then
        raise exception 'parent_local_key and parent_tax_legal_node_id disagree';
      end if;
      v_parent_id := v_node_id;
    end if;

    if coalesce(v_node ->> 'existing_tax_legal_node_id', '') <> '' then
      select n.id, n.country_code, n.tax_source_id
        into v_node_id, v_existing_country, v_existing_source
      from public.tax_legal_nodes n
      where n.id = (v_node ->> 'existing_tax_legal_node_id')::uuid;
      if v_node_id is null then
        raise exception 'existing_tax_legal_node_id not found';
      end if;
      if v_existing_country is distinct from v_proposal.country_code
        or v_existing_source is distinct from v_proposal.tax_source_id then
        raise exception 'existing_tax_legal_node_id must belong to the proposal country and tax_source';
      end if;
    else
      if coalesce(v_node ->> 'tax_legal_node_kind_id', '') = ''
        or coalesce(v_node ->> 'title', '') = ''
        or coalesce(v_node ->> 'node_code', '') = '' then
        raise exception 'new legal node requires tax_legal_node_kind_id, title, and backend-generated node_code';
      end if;
      select k.country_code into v_kind_country
      from public.tax_legal_node_kinds k
      where k.id = (v_node ->> 'tax_legal_node_kind_id')::uuid;
      if v_kind_country is distinct from v_proposal.country_code then
        raise exception 'tax_legal_node_kind_id must belong to the proposal country';
      end if;
      insert into public.tax_legal_nodes (
        country_code,
        tax_source_id,
        parent_node_id,
        tax_legal_node_kind_id,
        node_code,
        node_number,
        title,
        status,
        owner_note,
        sort_order,
        source_display_identifier,
        normalized_machine_identifier,
        identifier_base_number,
        identifier_letter_suffix,
        identifier_nested_components,
        printed_marker
      ) values (
        v_proposal.country_code,
        v_proposal.tax_source_id,
        v_parent_id,
        (v_node ->> 'tax_legal_node_kind_id')::uuid,
        v_node ->> 'node_code',
        nullif(v_node ->> 'node_number', ''),
        v_node ->> 'title',
        'draft',
        nullif(v_node ->> 'owner_note', ''),
        coalesce((v_node ->> 'sort_order')::integer, 0),
        nullif(v_node ->> 'source_display_identifier', ''),
        nullif(v_node ->> 'normalized_machine_identifier', ''),
        nullif(v_node ->> 'identifier_base_number', ''),
        nullif(v_node ->> 'identifier_letter_suffix', ''),
        coalesce(v_node -> 'identifier_nested_components', '[]'::jsonb),
        nullif(v_node ->> 'printed_marker', '')
      )
      returning id into v_node_id;
    end if;

    perform public.legal_ingestion_publication_map_put(
      v_proposal.id,
      v_proposal.country_code,
      'legal_node',
      v_node ->> 'local_key',
      'tax_legal_node',
      v_node_id
    );
    if v_first_node is null then
      select n.status into v_existing_status from public.tax_legal_nodes n where n.id = v_node_id;
      if v_existing_status = 'draft' then
        v_first_node := v_node_id;
      end if;
    end if;
  end loop;

  for v_rule in
    select value
    from jsonb_array_elements(coalesce(p_plan -> 'rules', '[]'::jsonb))
  loop
    if coalesce(v_rule ->> 'local_key', '') = '' then
      raise exception 'rule local_key is required';
    end if;
    if coalesce(v_rule ->> 'existing_tax_rule_id', '') <> '' then
      select r.id, r.country_code
        into v_rule_id, v_existing_country
      from public.tax_rules r
      where r.id = (v_rule ->> 'existing_tax_rule_id')::uuid;
      if v_rule_id is null then
        raise exception 'existing_tax_rule_id not found';
      end if;
      if v_existing_country is distinct from v_proposal.country_code then
        raise exception 'existing_tax_rule_id must belong to the proposal country';
      end if;
    else
      if coalesce(v_rule ->> 'title', '') = '' or coalesce(v_rule ->> 'rule_code', '') = '' then
        raise exception 'new tax rule requires title and backend-generated rule_code';
      end if;
      insert into public.tax_rules (
        country_code,
        rule_code,
        title,
        rule_kind,
        status,
        usage_hint,
        owner_note
      ) values (
        v_proposal.country_code,
        v_rule ->> 'rule_code',
        v_rule ->> 'title',
        'legal_rule',
        'draft',
        nullif(v_rule ->> 'usage_hint', ''),
        nullif(v_rule ->> 'owner_note', '')
      )
      returning id into v_rule_id;
    end if;

    perform public.legal_ingestion_publication_map_put(
      v_proposal.id,
      v_proposal.country_code,
      'rule',
      v_rule ->> 'local_key',
      'tax_rule',
      v_rule_id
    );
    if v_first_rule is null then
      v_first_rule := v_rule_id;
    end if;

    if v_rule ? 'legal_node_local_keys' then
      for v_text in select jsonb_array_elements_text(v_rule -> 'legal_node_local_keys')
      loop
        v_node_id := public.legal_ingestion_publication_mapped_id(
          v_proposal.id, 'legal_node', v_text
        );
        if v_node_id is null then
          raise exception 'rule % references unpublished node %', v_rule ->> 'local_key', v_text;
        end if;
        if not exists (
          select 1 from public.tax_rule_legal_nodes l
          where l.tax_rule_id = v_rule_id and l.tax_legal_node_id = v_node_id
        ) then
          insert into public.tax_rule_legal_nodes (country_code, tax_rule_id, tax_legal_node_id)
          values (v_proposal.country_code, v_rule_id, v_node_id);
        end if;
      end loop;
    end if;
    if v_rule ? 'existing_tax_legal_node_ids' then
      for v_text in select jsonb_array_elements_text(v_rule -> 'existing_tax_legal_node_ids')
      loop
        v_node_id := v_text::uuid;
        select n.country_code, n.tax_source_id
          into v_existing_country, v_existing_source
        from public.tax_legal_nodes n
        where n.id = v_node_id;
        if v_existing_country is distinct from v_proposal.country_code then
          raise exception 'linked tax_legal_node must belong to the proposal country';
        end if;
        if not exists (
          select 1 from public.tax_rule_legal_nodes l
          where l.tax_rule_id = v_rule_id and l.tax_legal_node_id = v_node_id
        ) then
          insert into public.tax_rule_legal_nodes (country_code, tax_rule_id, tax_legal_node_id)
          values (v_proposal.country_code, v_rule_id, v_node_id);
        end if;
      end loop;
    end if;

    if v_rule ? 'version' then
      if coalesce(p_plan ->> 'country_pack_id', '') = ''
        or coalesce(p_plan ->> 'country_pack_ruleset_id', '') = '' then
        raise exception 'draft tax_rule_version requires country_pack_id and country_pack_ruleset_id from the backend';
      end if;
      v_payload := v_rule -> 'version' -> 'payload_json';
      if jsonb_typeof(v_payload) is distinct from 'object' then
        raise exception 'rule version payload_json must be an object';
      end if;
      if public.legal_ingestion_jsonb_has_forbidden_statutory_key(v_payload) then
        raise exception 'rule version payload_json cannot store statutory amounts or legal_value_version_id';
      end if;
      v_checksum := nullif(v_rule -> 'version' ->> 'payload_checksum', '');
      if v_checksum is null then
        raise exception 'rule version payload_checksum is required from the command layer';
      end if;
      select coalesce(max(v.version_no), 0) + 1
        into v_next_version
      from public.tax_rule_versions v
      where v.tax_rule_id = v_rule_id;
      insert into public.tax_rule_versions (
        tax_rule_id,
        country_code,
        country_pack_id,
        country_pack_ruleset_id,
        version_no,
        status,
        effective_from,
        effective_to,
        payload_json,
        payload_checksum
      ) values (
        v_rule_id,
        v_proposal.country_code,
        (p_plan ->> 'country_pack_id')::uuid,
        (p_plan ->> 'country_pack_ruleset_id')::uuid,
        v_next_version,
        'draft',
        (v_rule -> 'version' ->> 'effective_from')::date,
        nullif(v_rule -> 'version' ->> 'effective_to', '')::date,
        v_payload,
        v_checksum
      )
      returning id into v_version_id;
      perform public.legal_ingestion_publication_map_put(
        v_proposal.id,
        v_proposal.country_code,
        'rule_version',
        v_rule ->> 'local_key',
        'tax_rule_version',
        v_version_id
      );
      if v_first_version is null then
        v_first_version := v_version_id;
      end if;

      if v_rule ? 'legal_value_ids' then
        for v_text in select jsonb_array_elements_text(v_rule -> 'legal_value_ids')
        loop
          v_value_id := v_text::uuid;
          select lv.country_code into v_existing_country
          from public.country_legal_values lv
          where lv.id = v_value_id;
          if v_existing_country is null then
            raise exception 'legal_value_id % does not exist; publication will not create Country Legal Values', v_value_id;
          end if;
          if v_existing_country is distinct from v_proposal.country_code then
            raise exception 'legal_value_id must belong to the proposal country';
          end if;
          if not exists (
            select 1 from public.tax_rule_version_legal_values b
            where b.tax_rule_version_id = v_version_id and b.legal_value_id = v_value_id
          ) then
            insert into public.tax_rule_version_legal_values (
              tax_rule_version_id, legal_value_id, country_code
            ) values (v_version_id, v_value_id, v_proposal.country_code);
          end if;
        end loop;
      end if;

      if v_rule ? 'source_pins' then
        for v_pin in select value from jsonb_array_elements(v_rule -> 'source_pins')
        loop
          v_source_id := coalesce((v_pin ->> 'tax_source_id')::uuid, v_proposal.tax_source_id);
          select s.country_code into v_existing_country
          from public.tax_sources s
          where s.id = v_source_id;
          if v_existing_country is distinct from v_proposal.country_code then
            raise exception 'source pin tax_source_id must belong to the proposal country';
          end if;
          if not exists (
            select 1
            from public.tax_rule_version_sources s
            where s.tax_rule_version_id = v_version_id
              and s.tax_source_id = v_source_id
              and coalesce(btrim(s.locator), '') = coalesce(btrim(v_pin ->> 'locator'), '')
          ) then
            insert into public.tax_rule_version_sources (
              tax_rule_version_id, tax_source_id, country_code, locator
            ) values (
              v_version_id,
              v_source_id,
              v_proposal.country_code,
              nullif(v_pin ->> 'locator', '')
            );
          end if;
        end loop;
      end if;
    end if;
  end loop;

  for v_rel in
    select value
    from jsonb_array_elements(coalesce(p_plan -> 'relationships', '[]'::jsonb))
  loop
    if coalesce(v_rel ->> 'from_local_key', '') <> '' then
      v_from_id := public.legal_ingestion_publication_mapped_id(
        v_proposal.id, 'rule_version', v_rel ->> 'from_local_key'
      );
    else
      v_from_id := (v_rel ->> 'from_tax_rule_version_id')::uuid;
    end if;
    if coalesce(v_rel ->> 'to_local_key', '') <> '' then
      v_to_id := public.legal_ingestion_publication_mapped_id(
        v_proposal.id, 'rule_version', v_rel ->> 'to_local_key'
      );
    else
      v_to_id := (v_rel ->> 'to_tax_rule_version_id')::uuid;
    end if;
    if v_from_id is null or v_to_id is null then
      raise exception 'relationship endpoints must resolve to tax_rule_versions';
    end if;
    if v_from_id = v_to_id then
      raise exception 'relationship endpoints must be different';
    end if;
    select v.country_code, v.status into v_existing_country, v_existing_status
    from public.tax_rule_versions v
    where v.id = v_from_id;
    if v_existing_country is distinct from v_proposal.country_code then
      raise exception 'relationship from_version must belong to the proposal country';
    end if;
    if v_existing_status is distinct from 'draft' then
      raise exception 'relationship from_version must be draft';
    end if;
    select v.country_code into v_pack_country
    from public.tax_rule_versions v
    where v.id = v_to_id;
    if v_pack_country is distinct from v_proposal.country_code then
      raise exception 'relationship to_version must belong to the proposal country';
    end if;
    if not exists (
      select 1 from public.tax_rule_relationships r
      where r.from_tax_rule_version_id = v_from_id
        and r.to_tax_rule_version_id = v_to_id
        and r.relationship_type = v_rel ->> 'relationship_type'
    ) then
      insert into public.tax_rule_relationships (
        country_code,
        from_tax_rule_version_id,
        to_tax_rule_version_id,
        relationship_type,
        status,
        owner_note,
        activation_critical
      ) values (
        v_proposal.country_code,
        v_from_id,
        v_to_id,
        v_rel ->> 'relationship_type',
        'active',
        nullif(v_rel ->> 'owner_note', ''),
        case
          when v_rel ? 'activation_critical' then (v_rel ->> 'activation_critical')::boolean
          else null
        end
      );
    end if;
  end loop;

  for v_unresolved in
    select value
    from jsonb_array_elements(coalesce(p_plan -> 'unresolved', '[]'::jsonb))
  loop
    if coalesce(v_unresolved ->> 'from_local_key', '') <> '' then
      v_from_id := public.legal_ingestion_publication_mapped_id(
        v_proposal.id, 'rule_version', v_unresolved ->> 'from_local_key'
      );
    else
      v_from_id := (v_unresolved ->> 'from_tax_rule_version_id')::uuid;
    end if;
    if v_from_id is null then
      raise exception 'unresolved reference from_version is required';
    end if;
    if not exists (
      select 1 from public.tax_rule_unresolved_legal_references u
      where u.from_tax_rule_version_id = v_from_id
        and u.relationship_intent = v_unresolved ->> 'relationship_intent'
        and u.locator_text = v_unresolved ->> 'locator_text'
    ) then
      insert into public.tax_rule_unresolved_legal_references (
        country_code,
        from_tax_rule_version_id,
        relationship_intent,
        locator_text,
        cited_instrument_kind,
        status,
        activation_critical,
        source_tax_source_id,
        cited_title
      ) values (
        v_proposal.country_code,
        v_from_id,
        v_unresolved ->> 'relationship_intent',
        v_unresolved ->> 'locator_text',
        v_unresolved ->> 'cited_instrument_kind',
        'open',
        case
          when v_unresolved ? 'activation_critical' then (v_unresolved ->> 'activation_critical')::boolean
          else null
        end,
        coalesce((v_unresolved ->> 'source_tax_source_id')::uuid, v_proposal.tax_source_id),
        nullif(v_unresolved ->> 'cited_title', '')
      );
    end if;
  end loop;

  update public.legal_ingestion_tax_knowledge_proposals
    set
      status = 'published_to_canonical_draft',
      published_tax_rule_id = v_first_rule,
      published_tax_rule_version_id = v_first_version,
      published_tax_legal_node_id = v_first_node,
      updated_by = p_actor_user_id,
      updated_at = now()
  where id = v_proposal.id
    and status = 'owner_approved';
  if not found then
    raise exception 'proposal publication status update failed';
  end if;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    payload_json
  ) values (
    null,
    p_actor_user_id,
    'legal_ingestion_tax_knowledge_proposals',
    v_proposal.id::text,
    'legal_training_tax_knowledge_proposal_published_to_canonical_draft',
    jsonb_build_object(
      'country_code', v_proposal.country_code,
      'document_id', v_proposal.document_id,
      'legal_text_draft_id', v_proposal.legal_text_draft_id,
      'published_tax_rule_id', v_first_rule,
      'published_tax_rule_version_id', v_first_version,
      'published_tax_legal_node_id', v_first_node
    )
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'local_kind', p.local_kind,
    'local_key', p.local_key,
    'canonical_object_type', p.canonical_object_type,
    'canonical_object_id', p.canonical_object_id
  ) order by p.created_at, p.local_kind, p.local_key), '[]'::jsonb)
    into v_publications
  from public.legal_ingestion_tax_knowledge_proposal_publications p
  where p.tax_knowledge_proposal_id = v_proposal.id;

  return jsonb_build_object(
    'already_published', false,
    'tax_knowledge_proposal_id', v_proposal.id,
    'country_code', v_proposal.country_code,
    'status', 'published_to_canonical_draft',
    'published_tax_rule_id', v_first_rule,
    'published_tax_rule_version_id', v_first_version,
    'published_tax_legal_node_id', v_first_node,
    'publications', v_publications
  );
end;
$$;

comment on function public.legal_ingestion_apply_tax_knowledge_proposal_canonical_draft_publication(uuid, uuid, jsonb) is
  'TAX-648C atomic B2→canonical DRAFT writer. service_role only. One transaction. Never activates. Never writes K4. Never creates facts or legal values. TAX-639/checksum/code generation remain command-layer invariants for 648B.';

revoke all on function public.legal_ingestion_apply_tax_knowledge_proposal_canonical_draft_publication(uuid, uuid, jsonb) from public;
revoke all on function public.legal_ingestion_apply_tax_knowledge_proposal_canonical_draft_publication(uuid, uuid, jsonb) from anon, authenticated;
grant execute on function public.legal_ingestion_apply_tax_knowledge_proposal_canonical_draft_publication(uuid, uuid, jsonb) to service_role;

revoke all on function public.legal_ingestion_publication_map_put(uuid, text, text, text, text, uuid) from public;
revoke all on function public.legal_ingestion_publication_map_put(uuid, text, text, text, text, uuid) from anon, authenticated, service_role;

revoke all on function public.legal_ingestion_publication_mapped_id(uuid, text, text) from public;
revoke all on function public.legal_ingestion_publication_mapped_id(uuid, text, text) from anon, authenticated, service_role;

revoke all on function public.legal_ingestion_jsonb_has_forbidden_statutory_key(jsonb) from public;
revoke all on function public.legal_ingestion_jsonb_has_forbidden_statutory_key(jsonb) from anon, authenticated, service_role;
