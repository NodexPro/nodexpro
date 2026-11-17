-- Client Operations: personal Reporting Table column visibility + system column widths.
-- Identity is organization + user (not period). Does NOT store org-owned custom column
-- visible/width_px. Does NOT import localStorage. DO NOT APPLY until release approval.

create table if not exists public.client_operations_user_sheet_preferences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  hidden_column_keys text[] not null default '{}'::text[],
  system_column_widths jsonb not null default '{}'::jsonb
    check (jsonb_typeof(system_column_widths) = 'object' and jsonb_typeof(system_column_widths) <> 'array'),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id) on delete set null,
  primary key (organization_id, user_id)
);

comment on table public.client_operations_user_sheet_preferences is
  'Personal Client Operations sheet layout (hidden columns + system column widths); not org-owned custom column width/visibility.';

alter table public.client_operations_user_sheet_preferences enable row level security;

create policy client_operations_user_sheet_preferences_select
  on public.client_operations_user_sheet_preferences for select to authenticated
  using (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    and user_id = (auth.jwt() ->> 'sub')::uuid
  );

create policy client_operations_user_sheet_preferences_insert
  on public.client_operations_user_sheet_preferences for insert to authenticated
  with check (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    and user_id = (auth.jwt() ->> 'sub')::uuid
  );

create policy client_operations_user_sheet_preferences_update
  on public.client_operations_user_sheet_preferences for update to authenticated
  using (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    and user_id = (auth.jwt() ->> 'sub')::uuid
  )
  with check (
    organization_id = (auth.jwt() ->> 'organization_id')::uuid
    and user_id = (auth.jwt() ->> 'sub')::uuid
  );

create or replace function public.apply_client_operations_user_hidden_columns(
  p_organization_id uuid,
  p_user_id uuid,
  p_hidden_column_keys text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_organization_id is null or p_user_id is null then
    raise exception 'organization_id and user_id required' using errcode = '22023';
  end if;
  if p_hidden_column_keys is null then
    raise exception 'hidden_column_keys required' using errcode = '22023';
  end if;
  if cardinality(p_hidden_column_keys) > 40 then
    raise exception 'hidden_column_keys bulk size invalid' using errcode = '22023';
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

  insert into public.client_operations_user_sheet_preferences (
    organization_id,
    user_id,
    hidden_column_keys,
    system_column_widths,
    updated_at,
    updated_by
  ) values (
    p_organization_id,
    p_user_id,
    p_hidden_column_keys,
    '{}'::jsonb,
    now(),
    p_user_id
  )
  on conflict (organization_id, user_id) do update
  set
    hidden_column_keys = excluded.hidden_column_keys,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;
end;
$$;

create or replace function public.apply_client_operations_user_system_column_width(
  p_organization_id uuid,
  p_user_id uuid,
  p_column_key text,
  p_width_px integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if p_organization_id is null or p_user_id is null then
    raise exception 'organization_id and user_id required' using errcode = '22023';
  end if;
  v_key := btrim(coalesce(p_column_key, ''));
  if v_key = '' or char_length(v_key) > 80 then
    raise exception 'invalid column_key' using errcode = '22023';
  end if;
  if p_width_px is null or p_width_px < 48 or p_width_px > 480 then
    raise exception 'width_px must be between 48 and 480' using errcode = '22023';
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

  insert into public.client_operations_user_sheet_preferences (
    organization_id,
    user_id,
    hidden_column_keys,
    system_column_widths,
    updated_at,
    updated_by
  ) values (
    p_organization_id,
    p_user_id,
    '{}'::text[],
    jsonb_build_object(v_key, p_width_px),
    now(),
    p_user_id
  )
  on conflict (organization_id, user_id) do update
  set
    system_column_widths = client_operations_user_sheet_preferences.system_column_widths || jsonb_build_object(v_key, p_width_px),
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;
end;
$$;

comment on function public.apply_client_operations_user_hidden_columns(uuid, uuid, text[]) is
  'Replace personal hidden Reporting Table columns for one user+organization.';
comment on function public.apply_client_operations_user_system_column_width(uuid, uuid, text, integer) is
  'Upsert one personal system column width; never writes org-owned custom column width_px.';

revoke all on function public.apply_client_operations_user_hidden_columns(uuid, uuid, text[]) from public;
revoke all on function public.apply_client_operations_user_hidden_columns(uuid, uuid, text[]) from anon, authenticated;
grant execute on function public.apply_client_operations_user_hidden_columns(uuid, uuid, text[]) to service_role;

revoke all on function public.apply_client_operations_user_system_column_width(uuid, uuid, text, integer) from public;
revoke all on function public.apply_client_operations_user_system_column_width(uuid, uuid, text, integer) from anon, authenticated;
grant execute on function public.apply_client_operations_user_system_column_width(uuid, uuid, text, integer) to service_role;
