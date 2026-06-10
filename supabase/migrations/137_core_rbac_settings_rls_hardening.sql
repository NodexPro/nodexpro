-- Core RBAC / settings tables: PostgREST lockdown (defense in depth).
-- Backend API uses service_role (bypasses RLS). No member policies — API-only access.

alter table public.organization_memberships enable row level security;
alter table public.organization_memberships force row level security;
revoke all on table public.organization_memberships from anon, authenticated;

alter table public.rbac_role_permissions enable row level security;
alter table public.rbac_role_permissions force row level security;
revoke all on table public.rbac_role_permissions from anon, authenticated;

alter table public.system_audit_log enable row level security;
alter table public.system_audit_log force row level security;
revoke all on table public.system_audit_log from anon, authenticated;

alter table public.organization_settings enable row level security;
alter table public.organization_settings force row level security;
revoke all on table public.organization_settings from anon, authenticated;

alter table public.user_invitations enable row level security;
alter table public.user_invitations force row level security;
revoke all on table public.user_invitations from anon, authenticated;
