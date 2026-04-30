-- Role model: owner, admin_manager, staff, viewer with proper permission distribution.
-- owner: billing, settings, users/access, module activation, revoke
-- admin_manager: broad operational access, no billing unless explicitly granted
-- staff: operational module access only, no settings, billing, module management
-- viewer: read-only where allowed

-- Add new roles (keep admin/member for backward compatibility during migration)
insert into public.roles (id, code, name, scope, is_system) values
  ('a0000000-0000-4000-8000-000000000010', 'owner', 'Owner', 'organization', true),
  ('a0000000-0000-4000-8000-000000000011', 'admin_manager', 'Admin / Manager', 'organization', true),
  ('a0000000-0000-4000-8000-000000000012', 'staff', 'Staff', 'organization', true)
on conflict (code) do nothing;

-- Add members:revoke permission (owner-only: revoke access)
insert into public.permissions (id, code, name, domain) values
  ('b0000000-0000-4000-8000-000000000020', 'members:revoke', 'Revoke member access', 'core')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.code = 'owner' and p.code = 'members:revoke'
on conflict (role_id, permission_id) do nothing;

-- Owner: all permissions (same as admin)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p where r.code = 'owner'
on conflict (role_id, permission_id) do nothing;

-- Admin_manager: operational access, no billing/settings/members management
-- Gets: org read/write, members read, roles read, modules read, clients *, documents *, audit read, settings read
-- Does NOT get: members:write, subscriptions:read, settings:write, modules:write
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.code = 'admin_manager'
  and p.code in (
    'organizations:read', 'organizations:write',
    'members:read', 'roles:read', 'modules:read',
    'clients:read', 'clients:write', 'clients:view_sensitive', 'clients:archive',
    'documents:read', 'documents:write', 'documents:view_sensitive', 'documents:archive',
    'audit:read', 'settings:read'
  )
on conflict (role_id, permission_id) do nothing;

-- Staff: operational only, no settings, billing, members, module management
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.code = 'staff'
  and p.code in (
    'organizations:read', 'modules:read',
    'clients:read', 'clients:write', 'clients:view_sensitive', 'clients:archive',
    'documents:read', 'documents:write', 'documents:view_sensitive', 'documents:archive'
  )
on conflict (role_id, permission_id) do nothing;

-- Viewer: read-only (already defined in 003, ensure it has documents:read and clients:read)
-- 003 gives: organizations:read, members:read, roles:read, modules:read, subscriptions:read, settings:read
-- 014 adds: clients:read
-- 017 adds: documents:read
-- No change needed for viewer - already correct.

-- Data migration: set owner_user_id for existing orgs (first admin/member becomes owner)
update public.organizations o
set owner_user_id = (
  select ou.user_id from public.organization_users ou
  join public.roles r on r.id = ou.role_id
  where ou.organization_id = o.id and ou.membership_status = 'active'
    and r.code in ('admin', 'owner', 'member')
  order by ou.joined_at asc
  limit 1
)
where o.owner_user_id is null;
