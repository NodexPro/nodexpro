-- DocFlow communication rule review / run: grant RBAC permission docflow.review
-- API maps this to legacy docflow:system_message_write via rbac.service RBAC_TO_LEGACY.

insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner', 'docflow.review'),
  ('admin', 'docflow.review'),
  ('staff', 'docflow.review')
on conflict (role_code, permission_code) do nothing;

-- Ensure marinator02@walla.com can use docflow review if they were viewer-only (staff+ gets docflow.review above).
update public.organization_memberships om
set role_code = 'staff', updated_at = now()
from public.users u
where om.user_id = u.id
  and om.status = 'active'
  and lower(trim(u.email)) = lower(trim('marinator02@walla.com'))
  and om.role_code = 'viewer';
