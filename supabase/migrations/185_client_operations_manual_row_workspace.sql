-- Stage 5.2: worker-scoped Client Operations manual rows.
-- Additive. Does not delete historical cells.
-- Existing cells have no deterministic worker owner, so they stay on the OFFICE sheet.
-- OFFICE subject is the sentinel 00000000-0000-0000-0000-000000000000.
-- Do not copy values onto member sheets. Do not read updated_by as an owner.

-- ---------------------------------------------------------------------------
-- Cell values
-- ---------------------------------------------------------------------------
alter table public.client_operations_manual_row_cell_values
  add column if not exists workspace_kind text not null default 'office';

alter table public.client_operations_manual_row_cell_values
  add column if not exists subject_user_id uuid not null default '00000000-0000-0000-0000-000000000000';

-- ---------------------------------------------------------------------------
-- Period setup (carry-forward marker is per sheet, not per organization)
-- ---------------------------------------------------------------------------
alter table public.client_operations_manual_rows_period_setup
  add column if not exists workspace_kind text not null default 'office';

alter table public.client_operations_manual_rows_period_setup
  add column if not exists subject_user_id uuid not null default '00000000-0000-0000-0000-000000000000';

-- BACKFILL START
-- Column defaults above already attached every pre-existing cell and setup row
-- to workspace_kind = 'office' and subject 00000000-0000-0000-0000-000000000000.
-- Re-assert only that OFFICE identity. Do not insert member copies.
-- Do not infer a worker owner. Do not rewrite a later member sheet back to OFFICE.
update public.client_operations_manual_row_cell_values
set
  workspace_kind = 'office',
  subject_user_id = '00000000-0000-0000-0000-000000000000'::uuid
where workspace_kind = 'office'
  and subject_user_id = '00000000-0000-0000-0000-000000000000'::uuid;

update public.client_operations_manual_rows_period_setup
set
  workspace_kind = 'office',
  subject_user_id = '00000000-0000-0000-0000-000000000000'::uuid
where workspace_kind = 'office'
  and subject_user_id = '00000000-0000-0000-0000-000000000000'::uuid;
-- BACKFILL END

alter table public.client_operations_manual_row_cell_values
  drop constraint if exists co_manual_cell_workspace_chk;

alter table public.client_operations_manual_row_cell_values
  add constraint co_manual_cell_workspace_chk check (
    (
      workspace_kind = 'office'
      and subject_user_id = '00000000-0000-0000-0000-000000000000'::uuid
    )
    or (
      workspace_kind = 'member'
      and subject_user_id <> '00000000-0000-0000-0000-000000000000'::uuid
    )
  );

alter table public.client_operations_manual_rows_period_setup
  drop constraint if exists co_manual_setup_workspace_chk;

alter table public.client_operations_manual_rows_period_setup
  add constraint co_manual_setup_workspace_chk check (
    (
      workspace_kind = 'office'
      and subject_user_id = '00000000-0000-0000-0000-000000000000'::uuid
    )
    or (
      workspace_kind = 'member'
      and subject_user_id <> '00000000-0000-0000-0000-000000000000'::uuid
    )
  );

alter table public.client_operations_manual_row_cell_values
  drop constraint if exists client_operations_manual_row_cell_values_pkey;

alter table public.client_operations_manual_row_cell_values
  add constraint client_operations_manual_row_cell_values_pkey
  primary key (
    organization_id,
    operational_period_key,
    workspace_kind,
    subject_user_id,
    manual_row_slot,
    column_key
  );

alter table public.client_operations_manual_rows_period_setup
  drop constraint if exists client_operations_manual_rows_period_setup_pkey;

alter table public.client_operations_manual_rows_period_setup
  add constraint client_operations_manual_rows_period_setup_pkey
  primary key (
    organization_id,
    operational_period_key,
    workspace_kind,
    subject_user_id
  );

create index if not exists idx_co_manual_row_cell_workspace
  on public.client_operations_manual_row_cell_values (
    organization_id,
    operational_period_key,
    workspace_kind,
    subject_user_id
  );

comment on column public.client_operations_manual_row_cell_values.workspace_kind is
  'office = historical office sheet; member = one worker sheet. Not inferred from updated_by.';

comment on column public.client_operations_manual_row_cell_values.subject_user_id is
  'OFFICE uses 00000000-0000-0000-0000-000000000000. member uses the workspace subject user id.';

-- ---------------------------------------------------------------------------
-- Subject must be an active member of the same organization.
-- Revoked, cross-organization, and sentinel-as-member writes are rejected.
-- ---------------------------------------------------------------------------
create or replace function public.co_manual_workspace_subject_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.workspace_kind = 'office' then
    if new.subject_user_id is distinct from '00000000-0000-0000-0000-000000000000'::uuid then
      raise exception 'MANUAL_WORKSPACE_OFFICE_SUBJECT' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.workspace_kind is distinct from 'member'
     or new.subject_user_id is not distinct from '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'MANUAL_WORKSPACE_MEMBER_SUBJECT' using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = new.organization_id
      and m.user_id = new.subject_user_id
      and m.status = 'active'
      and m.role_code in ('owner', 'admin', 'staff', 'viewer')
  ) then
    raise exception 'MANUAL_WORKSPACE_SUBJECT_FORBIDDEN' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists co_manual_cell_workspace_subject_guard
  on public.client_operations_manual_row_cell_values;
create trigger co_manual_cell_workspace_subject_guard
  before insert or update on public.client_operations_manual_row_cell_values
  for each row execute function public.co_manual_workspace_subject_guard();

drop trigger if exists co_manual_setup_workspace_subject_guard
  on public.client_operations_manual_rows_period_setup;
create trigger co_manual_setup_workspace_subject_guard
  before insert or update on public.client_operations_manual_rows_period_setup
  for each row execute function public.co_manual_workspace_subject_guard();

-- ---------------------------------------------------------------------------
-- Legacy first-touch RPC stays office → office only.
-- It must not copy member cells into the office sheet or seed a member sheet.
-- ---------------------------------------------------------------------------
create or replace function public.initialize_client_operations_manual_rows_for_period(
  p_organization_id uuid,
  p_operational_period_key text,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int := 0;
  v_year int;
  v_month int;
  v_prev text;
  v_office uuid := '00000000-0000-0000-0000-000000000000'::uuid;
begin
  if p_organization_id is null then
    raise exception 'organization_id required' using errcode = '22023';
  end if;
  if p_operational_period_key is null
     or p_operational_period_key !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'operational_period_key must be YYYY-MM' using errcode = '22023';
  end if;

  insert into public.client_operations_manual_rows_period_setup (
    organization_id,
    operational_period_key,
    workspace_kind,
    subject_user_id,
    initialized_at,
    initialized_by
  )
  values (
    p_organization_id,
    p_operational_period_key,
    'office',
    v_office,
    now(),
    p_actor_user_id
  )
  on conflict (organization_id, operational_period_key, workspace_kind, subject_user_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return false;
  end if;

  v_year := substring(p_operational_period_key from 1 for 4)::int;
  v_month := substring(p_operational_period_key from 6 for 2)::int;
  v_month := v_month - 1;
  if v_month < 1 then
    v_month := 12;
    v_year := v_year - 1;
  end if;
  if v_year < 1 then
    return true;
  end if;
  v_prev := lpad(v_year::text, 4, '0') || '-' || lpad(v_month::text, 2, '0');

  insert into public.client_operations_manual_row_cell_values (
    organization_id,
    operational_period_key,
    workspace_kind,
    subject_user_id,
    manual_row_slot,
    column_key,
    value_text,
    created_at,
    updated_at,
    updated_by
  )
  select
    p_organization_id,
    p_operational_period_key,
    'office',
    v_office,
    v.manual_row_slot,
    v.column_key,
    v.value_text,
    now(),
    now(),
    p_actor_user_id
  from public.client_operations_manual_row_cell_values v
  where v.organization_id = p_organization_id
    and v.operational_period_key = v_prev
    and v.workspace_kind = 'office'
    and v.subject_user_id = v_office
    and v.column_key <> 'folder'
    and length(btrim(v.value_text)) > 0
    and btrim(v.value_text) not in ('—', '–', '-', '־')
    and v.manual_row_slot in (
      select distinct v2.manual_row_slot
      from public.client_operations_manual_row_cell_values v2
      where v2.organization_id = p_organization_id
        and v2.operational_period_key = v_prev
        and v2.workspace_kind = 'office'
        and v2.subject_user_id = v_office
        and v2.column_key <> 'folder'
        and length(btrim(v2.value_text)) > 0
        and btrim(v2.value_text) not in ('—', '–', '-', '־')
    )
  on conflict (
    organization_id,
    operational_period_key,
    workspace_kind,
    subject_user_id,
    manual_row_slot,
    column_key
  ) do nothing;

  return true;
end;
$$;

comment on function public.initialize_client_operations_manual_rows_for_period(uuid, text, uuid) is
  'CO-185: claim the OFFICE manual-row sheet for a period and copy that OFFICE sheet from the previous calendar period only.';

revoke all on function public.initialize_client_operations_manual_rows_for_period(uuid, text, uuid) from public;
revoke all on function public.initialize_client_operations_manual_rows_for_period(uuid, text, uuid) from anon, authenticated;
grant execute on function public.initialize_client_operations_manual_rows_for_period(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Direct authenticated access follows the same sheet split.
-- Owner/Admin may read every sheet in the organization.
-- Staff/Viewer may read only their own member sheet, never the office sheet.
-- ---------------------------------------------------------------------------
create or replace function public.co_manual_workspace_row_visible(
  p_organization_id uuid,
  p_workspace_kind text,
  p_subject_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    join public.organization_memberships m
      on m.user_id = u.id
     and m.organization_id = p_organization_id
     and m.status = 'active'
    where u.auth_user_id = auth.uid()
      and (
        m.role_code in ('owner', 'admin')
        or (p_workspace_kind = 'member' and p_subject_user_id = u.id)
      )
  );
$$;

revoke all on function public.co_manual_workspace_row_visible(uuid, text, uuid) from public;
revoke all on function public.co_manual_workspace_row_visible(uuid, text, uuid) from anon;
grant execute on function public.co_manual_workspace_row_visible(uuid, text, uuid) to authenticated;

drop policy if exists "co_manual_row_cell_values_select_org_member"
  on public.client_operations_manual_row_cell_values;
drop policy if exists "co_manual_row_cell_values_insert_org_member"
  on public.client_operations_manual_row_cell_values;
drop policy if exists "co_manual_row_cell_values_update_org_member"
  on public.client_operations_manual_row_cell_values;
drop policy if exists "co_manual_row_cell_values_delete_org_member"
  on public.client_operations_manual_row_cell_values;

drop policy if exists "co_manual_row_cell_values_select_workspace"
  on public.client_operations_manual_row_cell_values;
create policy "co_manual_row_cell_values_select_workspace"
  on public.client_operations_manual_row_cell_values for select to authenticated
  using (public.co_manual_workspace_row_visible(organization_id, workspace_kind, subject_user_id));

drop policy if exists "co_manual_row_cell_values_insert_workspace"
  on public.client_operations_manual_row_cell_values;
create policy "co_manual_row_cell_values_insert_workspace"
  on public.client_operations_manual_row_cell_values for insert to authenticated
  with check (public.co_manual_workspace_row_visible(organization_id, workspace_kind, subject_user_id));

drop policy if exists "co_manual_row_cell_values_update_workspace"
  on public.client_operations_manual_row_cell_values;
create policy "co_manual_row_cell_values_update_workspace"
  on public.client_operations_manual_row_cell_values for update to authenticated
  using (public.co_manual_workspace_row_visible(organization_id, workspace_kind, subject_user_id))
  with check (public.co_manual_workspace_row_visible(organization_id, workspace_kind, subject_user_id));

drop policy if exists "co_manual_row_cell_values_delete_workspace"
  on public.client_operations_manual_row_cell_values;
create policy "co_manual_row_cell_values_delete_workspace"
  on public.client_operations_manual_row_cell_values for delete to authenticated
  using (public.co_manual_workspace_row_visible(organization_id, workspace_kind, subject_user_id));

drop policy if exists "co_manual_rows_period_setup_select_org_member"
  on public.client_operations_manual_rows_period_setup;
drop policy if exists "co_manual_rows_period_setup_insert_org_member"
  on public.client_operations_manual_rows_period_setup;
drop policy if exists "co_manual_rows_period_setup_update_org_member"
  on public.client_operations_manual_rows_period_setup;
drop policy if exists "co_manual_rows_period_setup_delete_org_member"
  on public.client_operations_manual_rows_period_setup;

drop policy if exists "co_manual_rows_period_setup_select_workspace"
  on public.client_operations_manual_rows_period_setup;
create policy "co_manual_rows_period_setup_select_workspace"
  on public.client_operations_manual_rows_period_setup for select to authenticated
  using (public.co_manual_workspace_row_visible(organization_id, workspace_kind, subject_user_id));

drop policy if exists "co_manual_rows_period_setup_insert_workspace"
  on public.client_operations_manual_rows_period_setup;
create policy "co_manual_rows_period_setup_insert_workspace"
  on public.client_operations_manual_rows_period_setup for insert to authenticated
  with check (public.co_manual_workspace_row_visible(organization_id, workspace_kind, subject_user_id));

drop policy if exists "co_manual_rows_period_setup_update_workspace"
  on public.client_operations_manual_rows_period_setup;
create policy "co_manual_rows_period_setup_update_workspace"
  on public.client_operations_manual_rows_period_setup for update to authenticated
  using (public.co_manual_workspace_row_visible(organization_id, workspace_kind, subject_user_id))
  with check (public.co_manual_workspace_row_visible(organization_id, workspace_kind, subject_user_id));

drop policy if exists "co_manual_rows_period_setup_delete_workspace"
  on public.client_operations_manual_rows_period_setup;
create policy "co_manual_rows_period_setup_delete_workspace"
  on public.client_operations_manual_rows_period_setup for delete to authenticated
  using (public.co_manual_workspace_row_visible(organization_id, workspace_kind, subject_user_id));
