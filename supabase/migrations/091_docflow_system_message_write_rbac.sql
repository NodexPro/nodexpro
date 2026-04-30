-- DocFlow office: explicit permission code expected by handlers (docflow:system_message_write).
-- Complements 090 docflow.review; either row expands to the other via API rbac.service RBAC_TO_LEGACY.

insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner', 'docflow:system_message_write'),
  ('admin', 'docflow:system_message_write'),
  ('staff', 'docflow:system_message_write')
on conflict (role_code, permission_code) do nothing;
