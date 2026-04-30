-- Accounting Base permissions registry + RBAC mapping.
-- Scope: Core/RBAC permission seed only.
-- No API/UI/module integration.

-- 1) Register official permission codes in Core registry.
insert into public.permissions (code, name, domain) values
  ('accounting_base.period.manage', 'Manage accounting periods', 'core'),
  ('accounting_base.entry.write', 'Create/update/finalize/archive accounting entries', 'core'),
  ('accounting_base.category.manage', 'Manage accounting categories', 'core'),
  ('accounting_base.link.manage', 'Manage accounting entry links', 'core'),
  ('accounting_base.view', 'View accounting base workspaces', 'core'),
  ('accounting_base.summary.view', 'View accounting summary workspace', 'core'),
  -- Existing permission string already used in code (read-model action gating).
  -- Registered here to avoid orphan permission checks and keep backward compatibility.
  ('accounting_base.summary.recompute', 'Recompute accounting summaries', 'core')
on conflict (code) do nothing;

-- 2) Map permissions to existing RBAC roles.
-- Note: current RBAC role_code constraint is ('owner','admin','staff','viewer').
-- There is no 'accountant' role_code in schema yet; staff acts as operational accounting role for now.

-- owner: full accounting base permissions
insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner', 'accounting_base.period.manage'),
  ('owner', 'accounting_base.entry.write'),
  ('owner', 'accounting_base.category.manage'),
  ('owner', 'accounting_base.link.manage'),
  ('owner', 'accounting_base.view'),
  ('owner', 'accounting_base.summary.view'),
  ('owner', 'accounting_base.summary.recompute')
on conflict (role_code, permission_code) do nothing;

-- admin: full operational accounting permissions
insert into public.rbac_role_permissions (role_code, permission_code) values
  ('admin', 'accounting_base.period.manage'),
  ('admin', 'accounting_base.entry.write'),
  ('admin', 'accounting_base.category.manage'),
  ('admin', 'accounting_base.link.manage'),
  ('admin', 'accounting_base.view'),
  ('admin', 'accounting_base.summary.view'),
  ('admin', 'accounting_base.summary.recompute')
on conflict (role_code, permission_code) do nothing;

-- staff (current accountant-equivalent operational role): entry/link + view/summary view
insert into public.rbac_role_permissions (role_code, permission_code) values
  ('staff', 'accounting_base.entry.write'),
  ('staff', 'accounting_base.link.manage'),
  ('staff', 'accounting_base.view'),
  ('staff', 'accounting_base.summary.view')
on conflict (role_code, permission_code) do nothing;

-- viewer: read-only accounting visibility
insert into public.rbac_role_permissions (role_code, permission_code) values
  ('viewer', 'accounting_base.view'),
  ('viewer', 'accounting_base.summary.view')
on conflict (role_code, permission_code) do nothing;
