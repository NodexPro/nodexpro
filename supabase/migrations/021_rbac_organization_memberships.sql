-- RBAC: organization_memberships (canonical membership table)
-- Extends platform security layer. Does not modify client/document/file/timeline schemas.

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role_code text not null check (role_code in ('owner', 'admin', 'staff', 'viewer')),
  status text not null default 'active' check (status in ('invited', 'active', 'revoked')),
  invited_by uuid references public.users(id),
  invited_at timestamptz,
  joined_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, user_id)
);

create index idx_organization_memberships_org on public.organization_memberships(organization_id);
create index idx_organization_memberships_user on public.organization_memberships(user_id);
create index idx_organization_memberships_status on public.organization_memberships(organization_id, status);

create trigger organization_memberships_updated_at before update on public.organization_memberships
  for each row execute function public.set_updated_at();

comment on table public.organization_memberships is 'RBAC: organization membership with role. One per user per org.';

-- Ensure roles table has owner, admin, staff, viewer
insert into public.roles (id, code, name, scope, is_system) values
  ('a0000000-0000-4000-8000-000000000020', 'owner', 'Owner', 'organization', true),
  ('a0000000-0000-4000-8000-000000000021', 'staff', 'Staff', 'organization', true)
on conflict (code) do nothing;

-- Migrate from organization_users to organization_memberships
-- Map: owner_user_id -> owner, admin/member -> admin, staff -> staff, viewer -> viewer
insert into public.organization_memberships (organization_id, user_id, role_code, status, invited_by, invited_at, joined_at, created_at, updated_at)
select
  ou.organization_id,
  ou.user_id,
  case
    when o.owner_user_id = ou.user_id then 'owner'
    when r.code in ('owner', 'admin', 'admin_manager', 'member') then 'admin'
    when r.code = 'staff' then 'staff'
    when r.code = 'viewer' then 'viewer'
    else 'staff'
  end,
  case when ou.membership_status = 'active' then 'active' when ou.membership_status = 'invited' then 'invited' else 'revoked' end,
  ou.invited_by,
  null,
  ou.joined_at,
  ou.created_at,
  ou.updated_at
from public.organization_users ou
join public.organizations o on o.id = ou.organization_id
join public.roles r on r.id = ou.role_id
where not exists (
  select 1 from public.organization_memberships om
  where om.organization_id = ou.organization_id and om.user_id = ou.user_id
);
