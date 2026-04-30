-- Minimal RBAC seed to ensure module catalog + activation work via requirePermission().
-- The middleware uses legacy codes like `modules:read` / `modules:write`, and the app's RBAC
-- loader reads from `public.rbac_role_permissions` (not legacy `public.role_permissions`).

insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner', 'modules:read'),
  ('owner', 'modules:write'),
  ('admin', 'modules:read'),
  ('admin', 'modules:write'),
  ('staff', 'modules:read'),
  ('viewer', 'modules:read')
on conflict (role_code, permission_code) do nothing;

