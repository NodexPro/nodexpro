-- RBAC permissions for business profile block (פרופיל עסקי)

insert into public.permissions (code, name, domain)
values
  ('business_profile.view', 'View business profile', 'business_profile'),
  ('business_profile.edit', 'Edit business profile', 'business_profile')
on conflict (code) do nothing;

-- Grant to standard organization roles (keep consistent with client_operations permissions).
insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner', 'business_profile.view'),
  ('owner', 'business_profile.edit'),
  ('admin', 'business_profile.view'),
  ('admin', 'business_profile.edit'),
  ('staff', 'business_profile.view'),
  ('staff', 'business_profile.edit'),
  ('viewer', 'business_profile.view')
on conflict (role_code, permission_code) do nothing;

