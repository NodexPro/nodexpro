-- F2A2A — Atomic tax fact definition version activation.
-- Tax Brain reserved migration range: 600–699. Next free number after 613 is 614.
-- Scope: shared per-version semantic lock + one SECURITY DEFINER activate RPC.
-- Does not alter migrations 600–613 files. Leaves 613 triggers enabled.
-- Does not compute SHA-256 in SQL. Compares the locked semantic snapshot to the
-- exact backend checksum INPUT payload, then persists checksum + ACTIVE together.
-- Exact version id only — never the newest row.
-- Not applied by this slice; backend service_role will call it after manual apply.

-- ==================================================
-- Shared advisory lock for activation + semantic mutation
-- ==================================================
-- Row locks on tax_fact_definition_versions cannot block INSERT of a new enum
-- option (different table). All checksum-affecting paths take the same
-- transaction advisory lock keyed to the exact version id:
--   pg_advisory_xact_lock(614, hashtext(version_id::text))
-- Participants:
--   - tax_fact_definition_version_activate (first statement)
--   - draft semantic UPDATE of tax_fact_definition_versions
--   - tax_fact_enum_options INSERT / UPDATE / DELETE
-- Presentation and identity semantic_title / owner_note do not take this lock.

create or replace function public.tax_fact_dictionary_lock_version_semantics(p_version_id uuid)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if p_version_id is null then
    raise exception 'tax_fact_definition_version_id is required';
  end if;
  perform pg_advisory_xact_lock(614, hashtext(p_version_id::text));
end;
$$;

comment on function public.tax_fact_dictionary_lock_version_semantics(uuid) is
  'F2A2A per-exact-version semantic publication lock. pg_advisory_xact_lock(614, hashtext(version_id)). Taken by activation and every checksum-affecting mutation. Not used for presentation or identity title/note.';

create or replace function public.tax_fact_definition_versions_lock_semantics()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.status = 'draft' and (
    old.value_type is distinct from new.value_type
    or old.unit_code is distinct from new.unit_code
    or old.currency_policy is distinct from new.currency_policy
    or old.validation_json is distinct from new.validation_json
    or old.definition_checksum is distinct from new.definition_checksum
    or new.status is distinct from old.status
  ) then
    perform public.tax_fact_dictionary_lock_version_semantics(new.id);
  end if;
  return new;
end;
$$;

comment on function public.tax_fact_definition_versions_lock_semantics() is
  'F2A2A: acquire the per-version semantic lock before draft checksum/semantic mutation or draft status change (activate/retire).';

drop trigger if exists tax_fact_definition_versions_semantic_lock
  on public.tax_fact_definition_versions;
create trigger tax_fact_definition_versions_semantic_lock
  before update on public.tax_fact_definition_versions
  for each row
  execute function public.tax_fact_definition_versions_lock_semantics();

-- Replace 613 parent-draft enum guard so the lock is taken BEFORE status is read.
-- Lock-then-recheck closes the phantom-insert race against activation.
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
    perform public.tax_fact_dictionary_lock_version_semantics(old.tax_fact_definition_version_id);
    select v.status into old_status
    from public.tax_fact_definition_versions v
    where v.id = old.tax_fact_definition_version_id;
    if old_status is distinct from 'draft' then
      raise exception
        'tax_fact_enum_options are immutable after the parent version leaves draft';
    end if;
    return old;
  end if;

  perform public.tax_fact_dictionary_lock_version_semantics(new.tax_fact_definition_version_id);
  if tg_op = 'UPDATE'
    and old.tax_fact_definition_version_id is distinct from new.tax_fact_definition_version_id
  then
    perform public.tax_fact_dictionary_lock_version_semantics(old.tax_fact_definition_version_id);
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

comment on function public.tax_fact_enum_options_requires_parent_draft() is
  'F2A2A: lock exact parent version semantics first, then re-read draft status. Prevents phantom enum insert against a concurrent activation of that exact version.';

-- 613 publication guard counts enum options. Acquire the same lock first so a
-- phantom INSERT cannot land after the count and before draft→active commits.
-- Triggers stay enabled; this replaces the function body only.
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

  perform public.tax_fact_dictionary_lock_version_semantics(new.id);

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
  'F2A1 structural publication plus F2A2A lock-before-count. Identity must be active; enum versions need >=1 option; non-enum versions must have zero options. Does not hash checksums. Does not call K3/K4/Strategy. Leaves 613 triggers enabled.';

-- ==================================================
-- Canonical semantic snapshot (no SHA-256)
-- ==================================================
-- SQL reconstructs the checksum INPUT payload and compares it to the
-- backend-supplied snapshot. SQL does not digest SHA-256.

create or replace function public.tax_fact_dictionary_jsonb_sort_keys(p jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when p is null then null
    when jsonb_typeof(p) = 'null' then 'null'::jsonb
    when jsonb_typeof(p) = 'array' then (
      select coalesce(
        jsonb_agg(public.tax_fact_dictionary_jsonb_sort_keys(elem) order by ordinality),
        '[]'::jsonb
      )
      from jsonb_array_elements(p) with ordinality as t(elem, ordinality)
    )
    when jsonb_typeof(p) = 'object' then (
      select coalesce(
        jsonb_object_agg(q.key, public.tax_fact_dictionary_jsonb_sort_keys(q.value)),
        '{}'::jsonb
      )
      from (
        select e.key, e.value
        from jsonb_each(p) as e
        order by e.key collate "C"
      ) q
    )
    else p
  end;
$$;

comment on function public.tax_fact_dictionary_jsonb_sort_keys(jsonb) is
  'F2A2A: recursively sort object keys; preserve JSON array order. Used for validation_json snapshot equality, not hashing.';

create or replace function public.tax_fact_dictionary_sorted_text_array(p jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when p is null or jsonb_typeof(p) is distinct from 'array' then '[]'::jsonb
    else coalesce(
      (
        select jsonb_agg(to_jsonb(s.code) order by s.code collate "C")
        from (
          select btrim(elem #>> '{}') as code
          from jsonb_array_elements(p) elem
          where jsonb_typeof(elem) = 'string'
            and btrim(elem #>> '{}') <> ''
        ) s
      ),
      '[]'::jsonb
    )
  end;
$$;

comment on function public.tax_fact_dictionary_sorted_text_array(jsonb) is
  'F2A2A: canonicalize a JSON string array as a sorted semantic set (enum_codes / allowed_currencies).';

create or replace function public.tax_fact_dictionary_canonicalize_currency_policy(p jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when p is null or jsonb_typeof(p) = 'null' then null
    when jsonb_typeof(p) is distinct from 'object' then p
    else public.tax_fact_dictionary_jsonb_sort_keys(
      jsonb_strip_nulls(
        jsonb_build_object(
          'allowed_currencies',
            case
              when not (p ? 'allowed_currencies') then null
              when jsonb_typeof(p -> 'allowed_currencies') = 'array' then
                public.tax_fact_dictionary_sorted_text_array(p -> 'allowed_currencies')
              else p -> 'allowed_currencies'
            end,
          'required',
            case
              when not (p ? 'required') then null
              else to_jsonb(
                jsonb_typeof(p -> 'required') = 'boolean'
                and (p -> 'required') = 'true'::jsonb
              )
            end
        )
      )
    )
  end;
$$;

comment on function public.tax_fact_dictionary_canonicalize_currency_policy(jsonb) is
  'F2A2A: match backend taxFactDefinitionChecksum currency_policy contract. allowed_currencies is a sorted set. required is boolean true/false when present.';

create or replace function public.tax_fact_dictionary_build_semantic_snapshot(
  p_fact_key text,
  p_country_code text,
  p_value_type text,
  p_unit_code text,
  p_currency_policy jsonb,
  p_validation_json jsonb,
  p_enum_codes jsonb
)
returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'country_code',
      nullif(btrim(upper(coalesce(p_country_code, ''))), ''),
    'currency_policy',
      public.tax_fact_dictionary_canonicalize_currency_policy(p_currency_policy),
    'enum_codes',
      public.tax_fact_dictionary_sorted_text_array(p_enum_codes),
    'fact_key',
      btrim(coalesce(p_fact_key, '')),
    'unit_code',
      nullif(btrim(coalesce(p_unit_code, '')), ''),
    'validation_json',
      public.tax_fact_dictionary_jsonb_sort_keys(
        case
          when p_validation_json is null or jsonb_typeof(p_validation_json) is distinct from 'object'
            then '{}'::jsonb
          else p_validation_json
        end
      ),
    'value_type',
      btrim(coalesce(p_value_type, ''))
  );
$$;

comment on function public.tax_fact_dictionary_build_semantic_snapshot(text, text, text, text, jsonb, jsonb, jsonb) is
  'F2A2A canonical checksum INPUT snapshot. Does not compute SHA-256. validation_json array order is preserved; enum_codes and allowed_currencies are sorted sets.';

create or replace function public.tax_fact_dictionary_canonicalize_semantic_snapshot(p jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when p is null or jsonb_typeof(p) is distinct from 'object' then null
    else public.tax_fact_dictionary_build_semantic_snapshot(
      p ->> 'fact_key',
      p ->> 'country_code',
      p ->> 'value_type',
      p ->> 'unit_code',
      case
        when p -> 'currency_policy' is null or jsonb_typeof(p -> 'currency_policy') = 'null' then null
        else p -> 'currency_policy'
      end,
      case
        when p -> 'validation_json' is null or jsonb_typeof(p -> 'validation_json') = 'null' then '{}'::jsonb
        else p -> 'validation_json'
      end,
      case
        when p -> 'enum_codes' is null or jsonb_typeof(p -> 'enum_codes') = 'null' then '[]'::jsonb
        else p -> 'enum_codes'
      end
    )
  end;
$$;

create or replace function public.tax_fact_dictionary_current_semantic_snapshot(p_version_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select public.tax_fact_dictionary_build_semantic_snapshot(
    d.fact_key,
    d.country_code,
    v.value_type,
    v.unit_code,
    v.currency_policy,
    v.validation_json,
    coalesce(
      (
        select jsonb_agg(to_jsonb(btrim(o.code)))
        from public.tax_fact_enum_options o
        where o.tax_fact_definition_version_id = v.id
      ),
      '[]'::jsonb
    )
  )
  from public.tax_fact_definition_versions v
  join public.tax_fact_definitions d on d.id = v.tax_fact_definition_id
  where v.id = p_version_id;
$$;

comment on function public.tax_fact_dictionary_current_semantic_snapshot(uuid) is
  'F2A2A: locked-reader helper. Builds the current checksum INPUT snapshot from identity + exact version + enum codes. Does not hash.';

-- ==================================================
-- Exact-version atomic activation RPC
-- ==================================================

create or replace function public.tax_fact_definition_version_activate(
  p_version_id uuid,
  p_expected_definition_checksum text,
  p_expected_semantic_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_definition_id uuid;
  v_identity public.tax_fact_definitions%rowtype;
  v_version public.tax_fact_definition_versions%rowtype;
  v_option_count integer;
  v_current jsonb;
  v_expected jsonb;
  v_updated integer;
begin
  if p_version_id is null then
    raise exception 'tax_fact_definition_version_id is required';
  end if;
  if p_expected_definition_checksum is null
    or btrim(p_expected_definition_checksum) = ''
  then
    raise exception 'expected definition_checksum is required';
  end if;
  if p_expected_semantic_snapshot is null
    or jsonb_typeof(p_expected_semantic_snapshot) is distinct from 'object'
  then
    raise exception 'expected semantic snapshot is required';
  end if;

  -- Exact version id only; do not resolve the newest row. Lock before any publication decision.
  perform public.tax_fact_dictionary_lock_version_semantics(p_version_id);

  select v.tax_fact_definition_id
    into v_definition_id
    from public.tax_fact_definition_versions v
    where v.id = p_version_id;
  if not found then
    raise exception 'Tax fact definition version not found';
  end if;

  select *
    into v_identity
    from public.tax_fact_definitions
    where id = v_definition_id
    for update;
  if not found then
    raise exception 'Tax fact definition not found';
  end if;

  select *
    into v_version
    from public.tax_fact_definition_versions
    where id = p_version_id
    for update;
  if not found then
    raise exception 'Tax fact definition version not found';
  end if;

  -- Already-active / retired / any non-draft is a hard conflict, never success.
  if v_version.status is distinct from 'draft' then
    raise exception
      'tax_fact_definition_version_activate requires the exact version to be draft (status=%)',
      v_version.status;
  end if;

  if v_identity.status is distinct from 'active' then
    raise exception
      'tax_fact_definition_versions cannot activate unless the fact identity is active';
  end if;

  if v_version.country_code is distinct from v_identity.country_code then
    raise exception
      'tax_fact_definition_versions.country_code must match tax_fact_definitions.country_code';
  end if;

  if v_version.value_type not in (
    'boolean',
    'integer',
    'decimal',
    'money',
    'percentage',
    'date',
    'enum',
    'string'
  ) then
    raise exception 'Invalid tax_fact_definition_versions value_type: %', v_version.value_type;
  end if;

  if not public.tax_fact_currency_policy_is_canonical(
    v_version.currency_policy,
    v_version.value_type
  ) then
    raise exception 'Invalid tax_fact currency_policy for value_type %', v_version.value_type;
  end if;

  if v_version.value_type = 'money'
    and (v_version.currency_policy ? 'allowed_currencies')
    and jsonb_array_length(v_version.currency_policy -> 'allowed_currencies') = 0
  then
    raise exception 'currency_policy.allowed_currencies cannot be empty';
  end if;

  if v_version.value_type is distinct from 'money'
    and v_version.currency_policy is not null
  then
    raise exception 'Non-money facts must store currency_policy NULL';
  end if;

  -- Compare the locked current semantic payload to the exact snapshot the backend hashed.
  -- Do not trust stored definition_checksum: enum mutation and checksum persist are
  -- separate PostgREST transactions, so stored checksum may lag S2.
  v_current := public.tax_fact_dictionary_current_semantic_snapshot(p_version_id);
  v_expected := public.tax_fact_dictionary_canonicalize_semantic_snapshot(p_expected_semantic_snapshot);
  if v_current is distinct from v_expected then
    raise exception
      'tax_fact_definition_version_activate semantic snapshot mismatch: locked semantic state is not the payload hashed as p_expected_definition_checksum';
  end if;

  select count(*)
    into v_option_count
    from public.tax_fact_enum_options o
    where o.tax_fact_definition_version_id = v_version.id;

  if v_version.value_type = 'enum' and v_option_count < 1 then
    raise exception
      'tax_fact_definition_versions cannot activate an enum without at least one enum option';
  end if;

  if v_version.value_type is distinct from 'enum' and v_option_count <> 0 then
    raise exception
      'tax_fact_definition_versions cannot activate a non-enum version that has enum options';
  end if;

  -- Persist the backend checksum and publish in ONE statement. Triggers stay enabled.
  -- 613 publication / immutability / country / GiST overlap triggers stay enabled.
  update public.tax_fact_definition_versions
    set
      definition_checksum = p_expected_definition_checksum,
      status = 'active'
    where id = p_version_id
      and status = 'draft';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception
      'tax_fact_definition_version_activate could not activate the exact draft version';
  end if;

  select *
    into v_version
    from public.tax_fact_definition_versions
    where id = p_version_id;

  return jsonb_build_object(
    'id', v_version.id,
    'tax_fact_definition_id', v_version.tax_fact_definition_id,
    'status', v_version.status,
    'definition_checksum', v_version.definition_checksum
  );
end;
$$;

comment on function public.tax_fact_definition_version_activate(uuid, text, jsonb) is
  'F2A2A atomic activation of an exact tax_fact_definition_version. Locks version semantics, compares locked semantic snapshot to p_expected_semantic_snapshot, persists p_expected_definition_checksum and draft→active in one UPDATE. Does not trust stored checksum. Does not hash SHA-256. Exact version id only. Leaves 613 triggers enabled. service_role only.';

revoke all on function public.tax_fact_dictionary_lock_version_semantics(uuid) from public;
revoke all on function public.tax_fact_dictionary_lock_version_semantics(uuid) from anon, authenticated;
grant execute on function public.tax_fact_dictionary_lock_version_semantics(uuid) to service_role;

revoke all on function public.tax_fact_definition_versions_lock_semantics() from public;
revoke all on function public.tax_fact_definition_versions_lock_semantics() from anon, authenticated;
grant execute on function public.tax_fact_definition_versions_lock_semantics() to service_role;

revoke all on function public.tax_fact_dictionary_jsonb_sort_keys(jsonb) from public;
revoke all on function public.tax_fact_dictionary_jsonb_sort_keys(jsonb) from anon, authenticated;
grant execute on function public.tax_fact_dictionary_jsonb_sort_keys(jsonb) to service_role;

revoke all on function public.tax_fact_dictionary_sorted_text_array(jsonb) from public;
revoke all on function public.tax_fact_dictionary_sorted_text_array(jsonb) from anon, authenticated;
grant execute on function public.tax_fact_dictionary_sorted_text_array(jsonb) to service_role;

revoke all on function public.tax_fact_dictionary_canonicalize_currency_policy(jsonb) from public;
revoke all on function public.tax_fact_dictionary_canonicalize_currency_policy(jsonb) from anon, authenticated;
grant execute on function public.tax_fact_dictionary_canonicalize_currency_policy(jsonb) to service_role;

revoke all on function public.tax_fact_dictionary_build_semantic_snapshot(text, text, text, text, jsonb, jsonb, jsonb) from public;
revoke all on function public.tax_fact_dictionary_build_semantic_snapshot(text, text, text, text, jsonb, jsonb, jsonb) from anon, authenticated;
grant execute on function public.tax_fact_dictionary_build_semantic_snapshot(text, text, text, text, jsonb, jsonb, jsonb) to service_role;

revoke all on function public.tax_fact_dictionary_canonicalize_semantic_snapshot(jsonb) from public;
revoke all on function public.tax_fact_dictionary_canonicalize_semantic_snapshot(jsonb) from anon, authenticated;
grant execute on function public.tax_fact_dictionary_canonicalize_semantic_snapshot(jsonb) to service_role;

revoke all on function public.tax_fact_dictionary_current_semantic_snapshot(uuid) from public;
revoke all on function public.tax_fact_dictionary_current_semantic_snapshot(uuid) from anon, authenticated;
grant execute on function public.tax_fact_dictionary_current_semantic_snapshot(uuid) to service_role;

revoke all on function public.tax_fact_definition_version_activate(uuid, text, jsonb) from public;
revoke all on function public.tax_fact_definition_version_activate(uuid, text, jsonb) from anon, authenticated;
grant execute on function public.tax_fact_definition_version_activate(uuid, text, jsonb) to service_role;
