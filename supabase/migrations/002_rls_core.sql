-- Phase 1: RLS baseline. Backend uses service_role and enforces tenant in code; RLS is defense-in-depth.
-- For authenticated role (e.g. future direct PostgREST): restrict by organization membership.

-- Helper: organization IDs where current auth user is active member
create or replace function public.organizations_for_current_auth_user()
returns setof uuid as $$
  select ou.organization_id
  from public.organization_users ou
  join public.users u on u.id = ou.user_id
  where u.auth_user_id = auth.uid()
    and ou.membership_status = 'active';
$$ language sql security definer stable;

-- Enable RLS on all tenant-scoped and sensitive tables
alter table public.users enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_users enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.plans enable row level security;
alter table public.modules enable row level security;
alter table public.plan_modules enable row level security;
alter table public.subscriptions enable row level security;
alter table public.organization_modules enable row level security;
alter table public.audit_log enable row level security;
alter table public.notifications enable row level security;
alter table public.file_assets enable row level security;

-- Users: own row or same org membership (for listing members)
create policy "users_select_own_or_org" on public.users for select
  using (
    id = (select u.id from public.users u where u.auth_user_id = auth.uid())
    or id in (select ou.user_id from public.organization_users ou join public.users u on u.id = ou.user_id where u.auth_user_id = auth.uid() and ou.membership_status = 'active')
  );

-- Organizations: only those where user is member
create policy "organizations_select_member" on public.organizations for select
  using (id in (select public.organizations_for_current_auth_user()));

-- Roles, permissions, plan_modules: readable by authenticated (registry data)
create policy "roles_select_all" on public.roles for select to authenticated using (true);
create policy "permissions_select_all" on public.permissions for select to authenticated using (true);
create policy "plan_modules_select_all" on public.plan_modules for select to authenticated using (true);
create policy "plans_select_all" on public.plans for select to authenticated using (true);
create policy "modules_select_all" on public.modules for select to authenticated using (true);

-- Organization_users: only in orgs where current user is member
create policy "organization_users_select_org_member" on public.organization_users for select
  using (organization_id in (select public.organizations_for_current_auth_user()));

-- Subscriptions: only own orgs
create policy "subscriptions_select_org_member" on public.subscriptions for select
  using (organization_id in (select public.organizations_for_current_auth_user()));

-- Organization_modules: only own orgs
create policy "organization_modules_select_org_member" on public.organization_modules for select
  using (organization_id in (select public.organizations_for_current_auth_user()));

-- Audit_log: only own orgs (or global if organization_id is null - restrict to admins later)
create policy "audit_log_select_org_member" on public.audit_log for select
  using (
    organization_id is null
    or organization_id in (select public.organizations_for_current_auth_user())
  );

-- Notifications: only own orgs
create policy "notifications_select_org_member" on public.notifications for select
  using (organization_id in (select public.organizations_for_current_auth_user()));

-- File_assets: only own orgs
create policy "file_assets_select_org_member" on public.file_assets for select
  using (organization_id in (select public.organizations_for_current_auth_user()));

-- Service role bypass: backend uses service_role; these policies apply to authenticated/anon
-- Service role has BYPASSRLS by default in Supabase.
