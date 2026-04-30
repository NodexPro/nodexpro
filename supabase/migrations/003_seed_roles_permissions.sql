-- Phase 1: Seed roles and permissions. RBAC baseline.

insert into public.roles (id, code, name, scope, is_system) values
  ('a0000000-0000-4000-8000-000000000001', 'admin', 'Administrator', 'organization', true),
  ('a0000000-0000-4000-8000-000000000002', 'member', 'Member', 'organization', true),
  ('a0000000-0000-4000-8000-000000000003', 'viewer', 'Viewer', 'organization', true)
on conflict (code) do nothing;

insert into public.permissions (id, code, name, domain) values
  ('b0000000-0000-4000-8000-000000000001', 'organizations:read', 'View organization', 'core'),
  ('b0000000-0000-4000-8000-000000000002', 'organizations:write', 'Edit organization', 'core'),
  ('b0000000-0000-4000-8000-000000000003', 'members:read', 'View members', 'core'),
  ('b0000000-0000-4000-8000-000000000004', 'members:write', 'Manage members', 'core'),
  ('b0000000-0000-4000-8000-000000000005', 'roles:read', 'View roles', 'core'),
  ('b0000000-0000-4000-8000-000000000006', 'modules:read', 'View modules', 'core'),
  ('b0000000-0000-4000-8000-000000000007', 'subscriptions:read', 'View subscription', 'core'),
  ('b0000000-0000-4000-8000-000000000008', 'audit:read', 'View audit log', 'core'),
  ('b0000000-0000-4000-8000-000000000009', 'settings:read', 'View settings', 'core'),
  ('b0000000-0000-4000-8000-000000000010', 'settings:write', 'Edit settings', 'core')
on conflict (code) do nothing;

-- Admin: all
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p where r.code = 'admin'
on conflict (role_id, permission_id) do nothing;

-- Member: all except audit (optional: give audit to admin only)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.code = 'member' and p.code != 'audit:read'
on conflict (role_id, permission_id) do nothing;

-- Viewer: read only
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.code = 'viewer' and p.code in ('organizations:read', 'members:read', 'roles:read', 'modules:read', 'subscriptions:read', 'settings:read')
on conflict (role_id, permission_id) do nothing;
