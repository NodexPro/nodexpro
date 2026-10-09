-- Stage 5.1 — Staff/Viewer client visibility, separate from handler responsibility.
-- Additive. Does not change assigned_handler_user_id, memberships, or staff-seat terms.
-- Does not touch migration 183.
--
-- Owner/Admin stay OFFICE and do not require a policy row.
-- Active Staff/Viewer are backfilled to access_mode = selected.
-- Grants are the clients currently assigned as handler. Never access_mode = all.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_id_organization_id_key'
  ) then
    alter table public.clients
      add constraint clients_id_organization_id_key unique (id, organization_id);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'organization_memberships_id_org_user_key'
  ) then
    alter table public.organization_memberships
      add constraint organization_memberships_id_org_user_key unique (id, organization_id, user_id);
  end if;
end $$;

create table if not exists public.organization_member_client_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null,
  user_id uuid not null,
  access_mode text not null check (access_mode in ('all', 'selected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid null references public.users(id) on delete set null,
  updated_by_user_id uuid null references public.users(id) on delete set null,
  constraint organization_member_client_access_membership_fk
    foreign key (membership_id, organization_id, user_id)
    references public.organization_memberships (id, organization_id, user_id)
    on delete cascade,
  constraint organization_member_client_access_org_membership_key
    unique (organization_id, membership_id),
  constraint organization_member_client_access_org_user_key
    unique (organization_id, user_id),
  constraint organization_member_client_access_membership_subject_key
    unique (membership_id, organization_id, user_id)
);

create index if not exists idx_member_client_access_org_user
  on public.organization_member_client_access (organization_id, user_id);

drop trigger if exists organization_member_client_access_updated_at
  on public.organization_member_client_access;
create trigger organization_member_client_access_updated_at
  before update on public.organization_member_client_access
  for each row execute function public.set_updated_at();

comment on table public.organization_member_client_access is
  'Staff/Viewer client visibility policy. all = current and future office clients. selected = explicit grants only. Not handler responsibility.';

create table if not exists public.organization_member_client_grants (
  organization_id uuid not null,
  membership_id uuid not null,
  user_id uuid not null,
  client_id uuid not null,
  created_at timestamptz not null default now(),
  created_by_user_id uuid null references public.users(id) on delete set null,
  primary key (organization_id, membership_id, client_id),
  constraint organization_member_client_grants_policy_fk
    foreign key (membership_id, organization_id, user_id)
    references public.organization_member_client_access (membership_id, organization_id, user_id)
    on delete cascade,
  constraint organization_member_client_grants_client_fk
    foreign key (client_id, organization_id)
    references public.clients (id, organization_id)
    on delete cascade
);

create index if not exists idx_member_client_grants_org_user
  on public.organization_member_client_grants (organization_id, user_id);

create index if not exists idx_member_client_grants_client
  on public.organization_member_client_grants (organization_id, client_id);

comment on table public.organization_member_client_grants is
  'Explicit Staff/Viewer client visibility grants. Ignored while access_mode is all. Not a handler assignment.';

alter table public.organization_member_client_access enable row level security;
alter table public.organization_member_client_access force row level security;
revoke all on table public.organization_member_client_access from anon, authenticated;

alter table public.organization_member_client_grants enable row level security;
alter table public.organization_member_client_grants force row level security;
revoke all on table public.organization_member_client_grants from anon, authenticated;

grant select, insert, update, delete on table public.organization_member_client_access to service_role;
grant select, insert, update, delete on table public.organization_member_client_grants to service_role;

-- BACKFILL START
-- Active Staff/Viewer only. Mode is always selected. Grants copy current handler assignments.
insert into public.organization_member_client_access (
  organization_id,
  membership_id,
  user_id,
  access_mode,
  created_at,
  updated_at
)
select
  m.organization_id,
  m.id,
  m.user_id,
  'selected',
  now(),
  now()
from public.organization_memberships m
where m.status = 'active'
  and m.role_code in ('staff', 'viewer')
on conflict (organization_id, membership_id) do nothing;

insert into public.organization_member_client_grants (
  organization_id,
  membership_id,
  user_id,
  client_id,
  created_at
)
select distinct
  m.organization_id,
  m.id,
  m.user_id,
  p.client_id,
  now()
from public.organization_memberships m
join public.organization_member_client_access a
  on a.organization_id = m.organization_id
 and a.membership_id = m.id
 and a.user_id = m.user_id
join public.client_operational_profiles p
  on p.organization_id = m.organization_id
 and p.assigned_handler_user_id = m.user_id
 and p.client_id is not null
join public.clients c
  on c.id = p.client_id
 and c.organization_id = m.organization_id
where m.status = 'active'
  and m.role_code in ('staff', 'viewer')
  and a.access_mode = 'selected'
on conflict (organization_id, membership_id, client_id) do nothing;
-- BACKFILL END

create or replace function public.delete_member_client_grants_for_archived_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.is_archived = true
     and old.is_archived is distinct from true then
    delete from public.organization_member_client_grants
    where organization_id = new.organization_id
      and client_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists clients_archive_clears_member_client_grants on public.clients;
create trigger clients_archive_clears_member_client_grants
  after update of is_archived on public.clients
  for each row execute function public.delete_member_client_grants_for_archived_client();

revoke all on function public.delete_member_client_grants_for_archived_client() from public, anon, authenticated;

create or replace function public.set_organization_member_client_access(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_access_mode text,
  p_selected_client_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_actor_status text;
  v_target_org uuid;
  v_target_user uuid;
  v_target_role text;
  v_target_status text;
  v_mode text;
  v_ids uuid[];
  v_old_mode text;
  v_old_ids uuid[];
  v_new_ids uuid[];
begin
  select role_code, status
    into v_actor_role, v_actor_status
  from public.organization_memberships
  where organization_id = p_organization_id
    and user_id = p_actor_user_id;

  if v_actor_status is distinct from 'active'
     or v_actor_role not in ('owner', 'admin') then
    raise exception 'MEMBER_CLIENT_ACCESS_FORBIDDEN';
  end if;

  select organization_id, user_id, role_code, status
    into v_target_org, v_target_user, v_target_role, v_target_status
  from public.organization_memberships
  where id = p_membership_id
  for update;

  if v_target_org is null or v_target_org is distinct from p_organization_id then
    raise exception 'MEMBER_CLIENT_ACCESS_CROSS_ORG_MEMBER';
  end if;
  if v_target_status is distinct from 'active' then
    raise exception 'MEMBER_CLIENT_ACCESS_TARGET_INACTIVE';
  end if;
  if v_target_role not in ('staff', 'viewer') then
    raise exception 'MEMBER_CLIENT_ACCESS_TARGET_ROLE';
  end if;

  v_mode := lower(btrim(coalesce(p_access_mode, '')));
  if v_mode not in ('all', 'selected') then
    raise exception 'MEMBER_CLIENT_ACCESS_MODE';
  end if;

  if v_mode = 'selected' then
    select coalesce(array_agg(distinct cid), '{}'::uuid[])
      into v_ids
    from unnest(coalesce(p_selected_client_ids, '{}'::uuid[])) as cid
    where cid is not null;

    if exists (
      select 1
      from unnest(v_ids) as cid
      join public.clients c on c.id = cid
      where c.organization_id is distinct from p_organization_id
    ) then
      raise exception 'MEMBER_CLIENT_ACCESS_CROSS_ORG_CLIENT';
    end if;

    if exists (
      select 1
      from unnest(v_ids) as cid
      join public.clients c on c.id = cid and c.organization_id = p_organization_id
      where c.is_archived = true
    ) then
      raise exception 'MEMBER_CLIENT_ACCESS_ARCHIVED_CLIENT';
    end if;

    if exists (
      select 1
      from unnest(v_ids) as cid
      where not exists (
        select 1
        from public.clients c
        where c.id = cid
          and c.organization_id = p_organization_id
          and c.is_archived = false
      )
    ) then
      raise exception 'MEMBER_CLIENT_ACCESS_UNKNOWN_CLIENT';
    end if;
  else
    v_ids := '{}'::uuid[];
  end if;

  select a.access_mode
    into v_old_mode
  from public.organization_member_client_access a
  where a.organization_id = p_organization_id
    and a.membership_id = p_membership_id;

  select coalesce(array_agg(g.client_id order by g.client_id), '{}'::uuid[])
    into v_old_ids
  from public.organization_member_client_grants g
  where g.organization_id = p_organization_id
    and g.membership_id = p_membership_id;

  insert into public.organization_member_client_access (
    organization_id,
    membership_id,
    user_id,
    access_mode,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    p_organization_id,
    p_membership_id,
    v_target_user,
    v_mode,
    p_actor_user_id,
    p_actor_user_id
  )
  on conflict (organization_id, membership_id) do update
    set access_mode = excluded.access_mode,
        user_id = excluded.user_id,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = now();

  delete from public.organization_member_client_grants
  where organization_id = p_organization_id
    and membership_id = p_membership_id
    and (
      v_mode = 'all'
      or client_id <> all (v_ids)
    );

  if v_mode = 'selected' then
    insert into public.organization_member_client_grants (
      organization_id,
      membership_id,
      user_id,
      client_id,
      created_by_user_id
    )
    select
      p_organization_id,
      p_membership_id,
      v_target_user,
      cid,
      p_actor_user_id
    from unnest(v_ids) as cid
    on conflict (organization_id, membership_id, client_id) do nothing;
  end if;

  select coalesce(array_agg(g.client_id order by g.client_id), '{}'::uuid[])
    into v_new_ids
  from public.organization_member_client_grants g
  where g.organization_id = p_organization_id
    and g.membership_id = p_membership_id;

  insert into public.audit_log (
    organization_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    payload_json
  )
  values (
    p_organization_id,
    p_actor_user_id,
    'organization_membership',
    p_membership_id::text,
    'member_client_access.set',
    jsonb_build_object(
      'target_user_id', v_target_user,
      'target_membership_id', p_membership_id,
      'old_access_mode', v_old_mode,
      'new_access_mode', v_mode,
      'old_selected_count', coalesce(array_length(v_old_ids, 1), 0),
      'new_selected_count', coalesce(array_length(v_new_ids, 1), 0),
      'old_selected_client_ids', to_jsonb(v_old_ids),
      'new_selected_client_ids', to_jsonb(v_new_ids)
    )
  );

  insert into public.system_audit_log (
    actor_user_id,
    organization_id,
    target_user_id,
    event_type,
    payload_json
  )
  values (
    p_actor_user_id,
    p_organization_id,
    v_target_user,
    'member_client_access.set',
    jsonb_build_object(
      'target_membership_id', p_membership_id,
      'old_access_mode', v_old_mode,
      'new_access_mode', v_mode,
      'old_selected_count', coalesce(array_length(v_old_ids, 1), 0),
      'new_selected_count', coalesce(array_length(v_new_ids, 1), 0),
      'old_selected_client_ids', to_jsonb(v_old_ids),
      'new_selected_client_ids', to_jsonb(v_new_ids)
    )
  );

  return jsonb_build_object(
    'aggregate_key', 'member_client_access',
    'organization_id', p_organization_id,
    'membership_id', p_membership_id,
    'user_id', v_target_user,
    'role_code', v_target_role,
    'status', v_target_status,
    'access_mode', v_mode,
    'selected_client_ids', to_jsonb(v_new_ids),
    'selected_client_count', coalesce(array_length(v_new_ids, 1), 0)
  );
end;
$$;

revoke all on function public.set_organization_member_client_access(uuid, uuid, uuid, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.set_organization_member_client_access(uuid, uuid, uuid, text, uuid[])
  to service_role;
