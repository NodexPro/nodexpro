-- RBAC: system_audit_log and check_permission function

create table if not exists public.system_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.users(id),
  organization_id uuid references public.organizations(id),
  target_user_id uuid references public.users(id),
  event_type text not null,
  payload_json jsonb,
  created_at timestamptz not null default now()
);

create index idx_system_audit_log_org on public.system_audit_log(organization_id, created_at desc);
create index idx_system_audit_log_actor on public.system_audit_log(actor_user_id, created_at desc);

-- Central permission check function
create or replace function public.check_permission(
  p_user_id uuid,
  p_organization_id uuid,
  p_permission_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_code text;
  v_has_permission boolean;
begin
  -- 1. Check membership
  select role_code into v_role_code
  from public.organization_memberships
  where user_id = p_user_id
    and organization_id = p_organization_id
    and status = 'active';

  if v_role_code is null then
    return false;
  end if;

  -- 2. Owner has all permissions
  if v_role_code = 'owner' then
    return true;
  end if;

  -- 3. Check role_permissions
  select exists (
    select 1 from public.rbac_role_permissions
    where role_code = v_role_code and permission_code = p_permission_code
  ) into v_has_permission;

  return v_has_permission;
end;
$$;
