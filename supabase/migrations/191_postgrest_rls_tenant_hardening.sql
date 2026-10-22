-- P0.1 — PostgREST / RLS hardening (forward-only).
-- Backend continues to use service_role (BYPASSRLS). First-party WEB uses Auth only (no .from()).
-- Do not apply this to production automatically. Verify on disposable/staging first.

-- 1) Canonical membership helper (was legacy organization_users only; no search_path).
create or replace function public.organizations_for_current_auth_user()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select om.organization_id
  from public.organization_memberships om
  join public.users u on u.id = om.user_id
  where u.auth_user_id = auth.uid()
    and om.status = 'active'
    and u.status = 'active'
  union
  select ou.organization_id
  from public.organization_users ou
  join public.users u on u.id = ou.user_id
  where u.auth_user_id = auth.uid()
    and ou.membership_status = 'active'
    and u.status = 'active'
    and not exists (
      select 1
      from public.organization_memberships om
      where om.user_id = u.id
        and om.organization_id = ou.organization_id
    );
$$;

-- 2) Platform settings: API-only. Drop member write/read policies.
drop policy if exists "platform_settings_select_org_member" on public.platform_settings;
drop policy if exists "platform_settings_insert_org_member" on public.platform_settings;
drop policy if exists "platform_settings_update_org_member" on public.platform_settings;
alter table public.platform_settings enable row level security;
alter table public.platform_settings force row level security;
revoke all on table public.platform_settings from anon, authenticated;

-- 3) Encrypted email-provider configs: API-only.
drop policy if exists "owner_email_provider_configs_select_org_member" on public.owner_email_provider_configs;
drop policy if exists "owner_email_provider_configs_insert_org_member" on public.owner_email_provider_configs;
drop policy if exists "owner_email_provider_configs_update_org_member" on public.owner_email_provider_configs;
alter table public.owner_email_provider_configs enable row level security;
alter table public.owner_email_provider_configs force row level security;
revoke all on table public.owner_email_provider_configs from anon, authenticated;

-- 4) Owner recovery OTP hashes: RLS + no authenticated grants.
alter table public.platform_owner_password_recovery_challenges enable row level security;
alter table public.platform_owner_password_recovery_challenges force row level security;
revoke all on table public.platform_owner_password_recovery_challenges from anon, authenticated, public;

-- 5) Work Engine command idempotency: same.
alter table public.work_engine_command_idempotency enable row level security;
alter table public.work_engine_command_idempotency force row level security;
revoke all on table public.work_engine_command_idempotency from anon, authenticated, public;

-- 6) Legal identity + sensitive access: no PostgREST.
alter table public.organization_legal_identities enable row level security;
alter table public.organization_legal_identities force row level security;
revoke all on table public.organization_legal_identities from anon, authenticated;

-- 7) Deny authenticated writes on remaining public tables (Auth lives in auth schema).
-- SELECT policies remain as defense-in-depth for leftover reads; first-party UI does not use PostgREST.
do $$
declare
  r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format(
      'revoke insert, update, delete, truncate on table public.%I from anon, authenticated',
      r.tablename
    );
  end loop;
end
$$;
