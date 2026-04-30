-- Phase 3: Permissions for shared clients and object-level access baseline.

insert into public.permissions (id, code, name, domain) values
  ('b0000000-0000-4000-8000-000000000012', 'clients:read', 'View clients', 'shared'),
  ('b0000000-0000-4000-8000-000000000013', 'clients:write', 'Create and edit clients', 'shared'),
  ('b0000000-0000-4000-8000-000000000014', 'clients:view_sensitive', 'View sensitive client data and notes', 'shared'),
  ('b0000000-0000-4000-8000-000000000015', 'clients:archive', 'Archive clients', 'shared')
on conflict (code) do nothing;

-- Admin and member get all client permissions
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.code in ('admin', 'member') and p.code in ('clients:read', 'clients:write', 'clients:view_sensitive', 'clients:archive')
on conflict (role_id, permission_id) do nothing;

-- Viewer gets read only (no view_sensitive by default; can be granted separately)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.code = 'viewer' and p.code = 'clients:read'
on conflict (role_id, permission_id) do nothing;
