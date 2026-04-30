-- Phase 4: Document Hub permissions.

insert into public.permissions (id, code, name, domain) values
  ('e0000000-0000-4000-8000-000000000001', 'documents:read', 'View documents', 'documents'),
  ('e0000000-0000-4000-8000-000000000002', 'documents:write', 'Create and edit documents', 'documents'),
  ('e0000000-0000-4000-8000-000000000003', 'documents:view_sensitive', 'View sensitive documents', 'documents'),
  ('e0000000-0000-4000-8000-000000000004', 'documents:archive', 'Archive documents', 'documents')
on conflict (code) do nothing;

-- Admin and member: full document access
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.code in ('admin', 'member') and p.code in ('documents:read', 'documents:write', 'documents:view_sensitive', 'documents:archive')
on conflict (role_id, permission_id) do nothing;

-- Viewer: read only
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.code = 'viewer' and p.code = 'documents:read'
on conflict (role_id, permission_id) do nothing;
