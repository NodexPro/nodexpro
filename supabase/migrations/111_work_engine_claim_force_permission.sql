-- Stage 10 Phase 1 hardening — dedicated permission for manager/owner force claim/release.
-- Does not grant to staff.

insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner',  'work_engine.claim.force'),
  ('admin',  'work_engine.claim.force')
on conflict (role_code, permission_code) do nothing;
