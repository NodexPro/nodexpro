-- Stage 5.4: per-member module access for Staff/Viewer.
-- Additive. Does not activate or purchase organization modules.
-- Owner/Admin do not need rows.
-- Existing grants stay when a membership is revoked; access checks require an active membership.

create table if not exists public.organization_member_module_access (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  membership_id uuid not null,
  user_id uuid not null,
  module_id uuid not null references public.modules(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid null references public.users(id) on delete set null,
  primary key (organization_id, membership_id, module_id),
  constraint organization_member_module_access_membership_fk
    foreign key (membership_id, organization_id, user_id)
    references public.organization_memberships (id, organization_id, user_id)
    on delete cascade,
  constraint organization_member_module_access_org_user_module_key
    unique (organization_id, user_id, module_id)
);

create index if not exists idx_member_module_access_org_user
  on public.organization_member_module_access (organization_id, user_id, enabled);

drop trigger if exists organization_member_module_access_updated_at
  on public.organization_member_module_access;
create trigger organization_member_module_access_updated_at
  before update on public.organization_member_module_access
  for each row execute function public.set_updated_at();

comment on table public.organization_member_module_access is
  'Staff/Viewer module grant. Missing or enabled=false denies. Does not entitle the organization.';

alter table public.organization_member_module_access enable row level security;
alter table public.organization_member_module_access force row level security;
revoke all on table public.organization_member_module_access from anon, authenticated;
grant select, insert, update, delete on table public.organization_member_module_access to service_role;

-- Permission code → catalog module. income.* grants the commercial invoice module.
-- Derived from rbac_role_permissions, not from the module display name.
create or replace function public.role_permission_grants_module(
  p_permission_code text,
  p_module_code text
)
returns boolean
language sql
immutable
as $$
  select case
    when p_module_code = 'client-operations' and p_permission_code like 'client_operations.%' then true
    when p_module_code in ('invoice', 'income') and p_permission_code like 'income.%' then true
    when p_module_code = 'docflow'
      and (p_permission_code like 'docflow.%' or p_permission_code like 'docflow:%') then true
    when p_module_code = 'work_engine' and p_permission_code like 'work_engine.%' then true
    else false
  end;
$$;

create or replace function public.organization_module_is_effectively_entitled(
  p_organization_id uuid,
  p_module_id uuid
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.modules mod
    join public.organization_modules om
      on om.module_id = mod.id
     and om.organization_id = p_organization_id
     and om.status = 'active'
    where mod.id = p_module_id
      and mod.is_active = true
      and (
        exists (
          select 1
          from public.organization_module_subscriptions s
          where s.organization_id = p_organization_id
            and s.module_id = mod.id
            and s.status in ('active', 'trialing')
            and (s.ends_at is null or s.ends_at > now())
            and (
              s.status <> 'trialing'
              or s.trial_ends_at is null
              or s.trial_ends_at > now()
            )
        )
        or exists (
          select 1
          from public.organization_trials t
          where t.organization_id = p_organization_id
            and t.trial_scope = 'full_platform'
            and t.status = 'trialing'
            and t.ends_at > now()
        )
      )
  );
$$;

-- BACKFILL START
-- Active Staff/Viewer only. Grant a module only when the organization is
-- effectively entitled to it today AND the role already has a permission that
-- enters that module. Do not grant inactive, future, or unentitled modules.
-- Do not insert Owner/Admin rows. Do not copy grants onto a later activation.
-- Only canonically member-assignable (user-facing) modules are backfilled.
-- Infrastructure modules (is_system without a /m/ app route, e.g. Work Engine) are
-- reached through a granted host module and never receive a member grant row.
insert into public.organization_member_module_access (
  organization_id,
  membership_id,
  user_id,
  module_id,
  enabled,
  created_at,
  updated_at
)
select
  m.organization_id,
  m.id,
  m.user_id,
  mod.id,
  true,
  now(),
  now()
from public.organization_memberships m
join public.organization_modules om
  on om.organization_id = m.organization_id
 and om.status = 'active'
join public.modules mod
  on mod.id = om.module_id
where m.status = 'active'
  and m.role_code in ('staff', 'viewer')
  and not (mod.is_system and coalesce(mod.nav_path, '') not like '/m/%')
  and public.organization_module_is_effectively_entitled(m.organization_id, mod.id)
  and exists (
    select 1
    from public.rbac_role_permissions rp
    where rp.role_code = m.role_code
      and public.role_permission_grants_module(rp.permission_code, mod.code)
  )
on conflict (organization_id, membership_id, module_id) do nothing;
-- BACKFILL END

create or replace function public.set_organization_member_module_access(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_module_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_target_user uuid;
  v_target_role text;
  v_target_status text;
  v_old uuid[];
  v_new uuid[];
  v_module uuid;
  v_enabled_modules jsonb;
begin
  if p_organization_id is null or p_actor_user_id is null or p_membership_id is null then
    raise exception 'MEMBER_MODULE_ACCESS_REQUIRED' using errcode = '22023';
  end if;

  select m.role_code into v_actor_role
  from public.organization_memberships m
  where m.organization_id = p_organization_id
    and m.user_id = p_actor_user_id
    and m.status = 'active';
  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    raise exception 'MEMBER_MODULE_ACCESS_FORBIDDEN' using errcode = '42501';
  end if;

  select m.user_id, m.role_code, m.status
    into v_target_user, v_target_role, v_target_status
  from public.organization_memberships m
  where m.id = p_membership_id
    and m.organization_id = p_organization_id;
  if v_target_user is null then
    raise exception 'MEMBER_MODULE_ACCESS_CROSS_ORG_MEMBER' using errcode = '42501';
  end if;
  if v_target_status is distinct from 'active' then
    raise exception 'MEMBER_MODULE_ACCESS_TARGET_INACTIVE' using errcode = '22023';
  end if;
  if v_target_role not in ('staff', 'viewer') then
    raise exception 'MEMBER_MODULE_ACCESS_TARGET_ROLE' using errcode = '42501';
  end if;

  if p_module_ids is null then
    p_module_ids := '{}'::uuid[];
  end if;
  if cardinality(p_module_ids) > 100 then
    raise exception 'MEMBER_MODULE_ACCESS_TOO_MANY' using errcode = '22023';
  end if;

  foreach v_module in array p_module_ids loop
    if not exists (select 1 from public.modules mod where mod.id = v_module) then
      raise exception 'MEMBER_MODULE_ACCESS_UNKNOWN_MODULE' using errcode = '22023';
    end if;
    if not public.organization_module_is_effectively_entitled(p_organization_id, v_module) then
      raise exception 'MEMBER_MODULE_ACCESS_UNENTITLED' using errcode = '42501';
    end if;
  end loop;

  select coalesce(array_agg(a.module_id order by a.module_id), '{}'::uuid[])
    into v_old
  from public.organization_member_module_access a
  where a.organization_id = p_organization_id
    and a.membership_id = p_membership_id
    and a.enabled = true;

  update public.organization_member_module_access
  set enabled = module_id = any (p_module_ids),
      updated_at = now(),
      updated_by_user_id = p_actor_user_id
  where organization_id = p_organization_id
    and membership_id = p_membership_id;

  insert into public.organization_member_module_access (
    organization_id,
    membership_id,
    user_id,
    module_id,
    enabled,
    updated_by_user_id
  )
  select
    p_organization_id,
    p_membership_id,
    v_target_user,
    mid,
    true,
    p_actor_user_id
  from unnest(p_module_ids) as mid
  on conflict (organization_id, membership_id, module_id) do update
    set enabled = true,
        updated_at = now(),
        updated_by_user_id = excluded.updated_by_user_id;

  select coalesce(array_agg(a.module_id order by a.module_id), '{}'::uuid[])
    into v_new
  from public.organization_member_module_access a
  where a.organization_id = p_organization_id
    and a.membership_id = p_membership_id
    and a.enabled = true;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('module_id', a.module_id, 'code', mod.code)
      order by mod.code
    ),
    '[]'::jsonb
  )
    into v_enabled_modules
  from public.organization_member_module_access a
  join public.modules mod on mod.id = a.module_id
  where a.organization_id = p_organization_id
    and a.membership_id = p_membership_id
    and a.enabled = true;

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
    'member_module_access.set',
    jsonb_build_object(
      'target_user_id', v_target_user,
      'target_membership_id', p_membership_id,
      'old_enabled_module_ids', to_jsonb(v_old),
      'new_enabled_module_ids', to_jsonb(v_new)
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
    'member_module_access.set',
    jsonb_build_object(
      'target_membership_id', p_membership_id,
      'old_enabled_module_ids', to_jsonb(v_old),
      'new_enabled_module_ids', to_jsonb(v_new)
    )
  );

  return jsonb_build_object(
    'aggregate_key', 'member_module_access',
    'organization_id', p_organization_id,
    'membership_id', p_membership_id,
    'user_id', v_target_user,
    'role_code', v_target_role,
    'status', v_target_status,
    'enabled_module_ids', to_jsonb(v_new),
    'enabled_modules', v_enabled_modules
  );
end;
$$;

revoke all on function public.set_organization_member_module_access(uuid, uuid, uuid, uuid[]) from public;
revoke all on function public.set_organization_member_module_access(uuid, uuid, uuid, uuid[]) from anon, authenticated;
grant execute on function public.set_organization_member_module_access(uuid, uuid, uuid, uuid[]) to service_role;

revoke all on function public.role_permission_grants_module(text, text) from public;
revoke all on function public.organization_module_is_effectively_entitled(uuid, uuid) from public;
grant execute on function public.role_permission_grants_module(text, text) to service_role;
grant execute on function public.organization_module_is_effectively_entitled(uuid, uuid) to service_role;
