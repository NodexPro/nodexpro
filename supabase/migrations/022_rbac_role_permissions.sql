-- RBAC: role_permissions (role_code, permission_code)
-- Permission matrix for owner, admin, staff, viewer

create table if not exists public.rbac_role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_code text not null check (role_code in ('owner', 'admin', 'staff', 'viewer')),
  permission_code text not null,
  created_at timestamptz not null default now(),
  unique(role_code, permission_code)
);

create index idx_rbac_role_permissions_role on public.rbac_role_permissions(role_code);

-- Permission codes
-- view_clients, edit_clients, archive_clients
-- view_documents, upload_documents, delete_documents
-- view_users, invite_users, change_user_role, revoke_user_access
-- access_settings, access_billing

-- OWNER: all permissions
insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner', 'view_clients'), ('owner', 'edit_clients'), ('owner', 'archive_clients'),
  ('owner', 'view_documents'), ('owner', 'upload_documents'), ('owner', 'delete_documents'),
  ('owner', 'view_users'), ('owner', 'invite_users'), ('owner', 'change_user_role'), ('owner', 'revoke_user_access'),
  ('owner', 'access_settings'), ('owner', 'access_billing')
on conflict (role_code, permission_code) do nothing;

-- ADMIN: no revoke_user_access, no access_billing
insert into public.rbac_role_permissions (role_code, permission_code) values
  ('admin', 'view_clients'), ('admin', 'edit_clients'), ('admin', 'archive_clients'),
  ('admin', 'view_documents'), ('admin', 'upload_documents'), ('admin', 'delete_documents'),
  ('admin', 'view_users'), ('admin', 'invite_users'), ('admin', 'change_user_role'),
  ('admin', 'access_settings')
on conflict (role_code, permission_code) do nothing;

-- STAFF: operational only
insert into public.rbac_role_permissions (role_code, permission_code) values
  ('staff', 'view_clients'), ('staff', 'edit_clients'),
  ('staff', 'view_documents'), ('staff', 'upload_documents')
on conflict (role_code, permission_code) do nothing;

-- VIEWER: read only
insert into public.rbac_role_permissions (role_code, permission_code) values
  ('viewer', 'view_clients'), ('viewer', 'view_documents')
on conflict (role_code, permission_code) do nothing;
