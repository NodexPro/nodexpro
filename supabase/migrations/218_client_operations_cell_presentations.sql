-- Client Operations: per-user decorative cell formatting (fill/font/align).
-- Schema + atomic bulk apply RPC. Does NOT import localStorage.
-- Does NOT mix with client_operations_cell_manual_statuses (shared business markers).
-- DO NOT APPLY until release approval. Migrations 217 already PROD — do not reapply.

create table if not exists public.client_operations_cell_presentations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  operational_period_key text not null
    check (operational_period_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  row_kind text not null
    check (row_kind in ('client', 'manual')),
  row_id text not null
    check (char_length(btrim(row_id)) >= 1 and char_length(row_id) <= 80),
  column_key text not null
    check (char_length(btrim(column_key)) >= 1 and char_length(column_key) <= 80 and btrim(column_key) <> 'folder'),
  presentation jsonb not null
    check (jsonb_typeof(presentation) = 'object' and presentation <> '{}'::jsonb),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id) on delete set null,
  primary key (organization_id, user_id, operational_period_key, row_kind, row_id, column_key)
);

comment on table public.client_operations_cell_presentations is
  'Personal decorative cell formatting for Client Operations Reporting Table; not business status, Accounting Base, or statutory truth.';

create index if not exists idx_co_cell_presentations_org_user_period
  on public.client_operations_cell_presentations (organization_id, user_id, operational_period_key);

alter table public.client_operations_cell_presentations enable row level security;

create policy client_operations_cell_presentations_select
  on public.client_operations_cell_presentations for select to authenticated
  using (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    and user_id = (auth.jwt() ->> 'sub')::uuid
  );

create policy client_operations_cell_presentations_insert
  on public.client_operations_cell_presentations for insert to authenticated
  with check (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    and user_id = (auth.jwt() ->> 'sub')::uuid
  );

create policy client_operations_cell_presentations_update
  on public.client_operations_cell_presentations for update to authenticated
  using (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    and user_id = (auth.jwt() ->> 'sub')::uuid
  )
  with check (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    and user_id = (auth.jwt() ->> 'sub')::uuid
  );

create policy client_operations_cell_presentations_delete
  on public.client_operations_cell_presentations for delete to authenticated
  using (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    and user_id = (auth.jwt() ->> 'sub')::uuid
  );

create or replace function public.apply_client_operations_cell_presentations(
  p_organization_id uuid,
  p_user_id uuid,
  p_operational_period_key text,
  p_cells jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  rec jsonb;
  v_row_kind text;
  v_row_id text;
  v_column_key text;
  v_presentation jsonb;
  v_applied integer := 0;
  v_client_id uuid;
begin
  if p_organization_id is null or p_user_id is null then
    raise exception 'organization_id and user_id required' using errcode = '22023';
  end if;
  if p_operational_period_key is null or p_operational_period_key !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'operational_period_key must be YYYY-MM' using errcode = '22023';
  end if;
  if jsonb_typeof(p_cells) is distinct from 'array' then
    raise exception 'cells must be a json array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_cells) < 1 or jsonb_array_length(p_cells) > 2000 then
    raise exception 'cells bulk size invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = p_user_id
      and m.status = 'active'
  ) then
    raise exception 'user is not an active member of organization' using errcode = '42501';
  end if;

  for rec in select value from jsonb_array_elements(p_cells)
  loop
    v_row_kind := rec->>'row_kind';
    v_row_id := btrim(coalesce(rec->>'row_id', ''));
    v_column_key := btrim(coalesce(rec->>'column_key', ''));
    if rec ? 'presentation'
      and rec->'presentation' is not null
      and jsonb_typeof(rec->'presentation') <> 'null'
    then
      v_presentation := rec->'presentation';
    else
      v_presentation := null;
    end if;

    if v_row_kind not in ('client', 'manual') then
      raise exception 'invalid row_kind' using errcode = '22023';
    end if;
    if v_row_id = '' or char_length(v_row_id) > 80 then
      raise exception 'invalid row_id' using errcode = '22023';
    end if;
    if v_column_key = '' or char_length(v_column_key) > 80 or v_column_key = 'folder' then
      raise exception 'invalid column_key' using errcode = '22023';
    end if;

    if v_row_kind = 'client' then
      begin
        v_client_id := v_row_id::uuid;
      exception when invalid_text_representation then
        raise exception 'client row_id must be uuid' using errcode = '22023';
      end;
      if not exists (
        select 1
        from public.clients c
        where c.id = v_client_id
          and c.organization_id = p_organization_id
      ) then
        raise exception 'client does not belong to organization' using errcode = '42501';
      end if;
    else
      if v_row_id !~ '^manual:0[1-5]$' then
        raise exception 'invalid manual row_id' using errcode = '22023';
      end if;
    end if;

    if v_presentation is null or v_presentation = '{}'::jsonb then
      delete from public.client_operations_cell_presentations
      where organization_id = p_organization_id
        and user_id = p_user_id
        and operational_period_key = p_operational_period_key
        and row_kind = v_row_kind
        and row_id = v_row_id
        and column_key = v_column_key;
    else
      if jsonb_typeof(v_presentation) <> 'object' then
        raise exception 'presentation must be an object' using errcode = '22023';
      end if;
      insert into public.client_operations_cell_presentations (
        organization_id,
        user_id,
        operational_period_key,
        row_kind,
        row_id,
        column_key,
        presentation,
        updated_at,
        updated_by
      ) values (
        p_organization_id,
        p_user_id,
        p_operational_period_key,
        v_row_kind,
        v_row_id,
        v_column_key,
        v_presentation,
        now(),
        p_user_id
      )
      on conflict (organization_id, user_id, operational_period_key, row_kind, row_id, column_key)
      do update set
        presentation = excluded.presentation,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;
    end if;
    v_applied := v_applied + 1;
  end loop;

  return v_applied;
end;
$$;

comment on function public.apply_client_operations_cell_presentations(uuid, uuid, text, jsonb) is
  'Atomically upsert/delete a bulk of personal Client Operations cell presentations for one user+period.';

revoke all on function public.apply_client_operations_cell_presentations(uuid, uuid, text, jsonb) from public;
revoke all on function public.apply_client_operations_cell_presentations(uuid, uuid, text, jsonb) from anon, authenticated;
grant execute on function public.apply_client_operations_cell_presentations(uuid, uuid, text, jsonb) to service_role;
