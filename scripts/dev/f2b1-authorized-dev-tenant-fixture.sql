-- =============================================================================
-- F2B1 DEV-ONLY tenant smoke fixture
-- =============================================================================
-- Authorized project: NodexPro Tax Brain DEV
-- ref: jgxezhjctrgfbmmkqqhn
--
-- WRITE-ONLY artifact. Not a migration. Not wired into supabase/seed or reset.
-- Do not run on production. Do not GRANT / ALTER / change RLS.
-- Do not insert auth.users or public.users. Do not create legal identities.
--
-- Prerequisites:
--   1. One Supabase Auth user exists (created outside this file).
--   2. One public.users row exists for that Auth user (ensureAppUser / Bearer).
--   3. Run as a role that can INSERT these public tables (SQL Editor / postgres).
--
-- Required parameter:
--   Replace v_smoke_email below with that public.users.email before running.
-- =============================================================================

begin;

do $fixture$
declare
  -- >>> REQUIRED: set to the existing public.users.email <<<
  v_smoke_email constant text := 'SET_ME@example.com';

  c_org_id        constant uuid := 'd1000000-0000-4000-8000-000000000001';
  c_ou_id         constant uuid := 'd1000000-0000-4000-8000-000000000002';
  c_ocs_id        constant uuid := 'd1000000-0000-4000-8000-000000000003';
  c_trial_id      constant uuid := 'd1000000-0000-4000-8000-000000000004';
  c_om_id         constant uuid := 'd1000000-0000-4000-8000-000000000005';
  c_client_id     constant uuid := 'd1000000-0000-4000-8000-000000000006';
  c_admin_role_id constant uuid := 'a0000000-0000-4000-8000-000000000001';
  c_module_id     constant uuid := 'f1000000-0000-4000-8000-000000000007';

  c_legal_hash constant text := 'dev-only-f2b1-smoke-legal-identity-hash';

  v_user_id uuid;
  v_user_hits integer;
begin
  if v_smoke_email is null
     or btrim(v_smoke_email) = ''
     or lower(btrim(v_smoke_email)) = 'set_me@example.com' then
    raise exception
      'F2B1 fixture: set v_smoke_email to an existing public.users.email before running';
  end if;

  -- ----- assertions (fail before any insert) -----
  if not exists (
    select 1
    from public.countries
    where code = 'IL'
      and status = 'active'
  ) then
    raise exception 'F2B1 fixture: countries.IL is missing or not active';
  end if;

  if not exists (
    select 1
    from public.roles
    where id = c_admin_role_id
      and code = 'admin'
  ) then
    raise exception
      'F2B1 fixture: admin role % is missing',
      c_admin_role_id;
  end if;

  if not exists (
    select 1
    from public.modules
    where id = c_module_id
      and code = 'tax-advisory'
  ) then
    raise exception
      'F2B1 fixture: tax-advisory module % is missing',
      c_module_id;
  end if;

  select count(*)
  into v_user_hits
  from public.users
  where lower(btrim(email)) = lower(btrim(v_smoke_email));

  if v_user_hits = 0 then
    raise exception
      'F2B1 fixture: no public.users row for email % — create Auth user and call API with Bearer first',
      v_smoke_email;
  end if;

  if v_user_hits > 1 then
    raise exception
      'F2B1 fixture: % public.users rows for email % — expected exactly one',
      v_user_hits,
      v_smoke_email;
  end if;

  select id
  into strict v_user_id
  from public.users
  where lower(btrim(email)) = lower(btrim(v_smoke_email));

  -- ----- 1. organizations -----
  if exists (
    select 1 from public.organizations where id = c_org_id
  ) then
    if not exists (
      select 1
      from public.organizations
      where id = c_org_id
        and name = 'F2B1 DEV Smoke'
        and country_code = 'IL'
        and timezone = 'Asia/Jerusalem'
        and status = 'active'
    ) then
      raise exception
        'F2B1 fixture conflict: organizations % exists with different data',
        c_org_id;
    end if;
  else
    insert into public.organizations (
      id,
      name,
      country_code,
      timezone,
      status
    ) values (
      c_org_id,
      'F2B1 DEV Smoke',
      'IL',
      'Asia/Jerusalem',
      'active'
    );
  end if;

  -- ----- 2. organization_users -----
  if exists (
    select 1
    from public.organization_users
    where organization_id = c_org_id
      and user_id = v_user_id
      and id <> c_ou_id
  ) then
    raise exception
      'F2B1 fixture conflict: organization_users already has a different row for this org+user';
  end if;

  if exists (
    select 1 from public.organization_users where id = c_ou_id
  ) then
    if not exists (
      select 1
      from public.organization_users
      where id = c_ou_id
        and organization_id = c_org_id
        and user_id = v_user_id
        and role_id = c_admin_role_id
        and membership_status = 'active'
    ) then
      raise exception
        'F2B1 fixture conflict: organization_users % exists with different data',
        c_ou_id;
    end if;
  else
    insert into public.organization_users (
      id,
      organization_id,
      user_id,
      role_id,
      membership_status
    ) values (
      c_ou_id,
      c_org_id,
      v_user_id,
      c_admin_role_id,
      'active'
    );
  end if;

  -- ----- 3. organization_country_settings -----
  if exists (
    select 1
    from public.organization_country_settings
    where organization_id = c_org_id
      and id <> c_ocs_id
  ) then
    raise exception
      'F2B1 fixture conflict: organization_country_settings already has a different row for this org';
  end if;

  if exists (
    select 1 from public.organization_country_settings where id = c_ocs_id
  ) then
    if not exists (
      select 1
      from public.organization_country_settings
      where id = c_ocs_id
        and organization_id = c_org_id
        and country_code = 'IL'
        and active_country_pack_id is null
        and active_ruleset_id is null
        and settings_status = 'active'
    ) then
      raise exception
        'F2B1 fixture conflict: organization_country_settings % exists with different data',
        c_ocs_id;
    end if;
  else
    insert into public.organization_country_settings (
      id,
      organization_id,
      country_code,
      active_country_pack_id,
      active_ruleset_id,
      settings_status
    ) values (
      c_ocs_id,
      c_org_id,
      'IL',
      null,
      null,
      'active'
    );
  end if;

  -- ----- 4. organization_trials -----
  -- Timestamps are not compared on rerun (first-run now() would otherwise conflict).
  if exists (
    select 1
    from public.organization_trials
    where organization_id = c_org_id
      and trial_scope = 'full_platform'
      and id <> c_trial_id
  ) then
    raise exception
      'F2B1 fixture conflict: organization_trials already has a different full_platform row for this org';
  end if;

  if exists (
    select 1 from public.organization_trials where id = c_trial_id
  ) then
    if not exists (
      select 1
      from public.organization_trials
      where id = c_trial_id
        and organization_id = c_org_id
        and legal_identity_hash = c_legal_hash
        and trial_scope = 'full_platform'
        and status = 'trialing'
    ) then
      raise exception
        'F2B1 fixture conflict: organization_trials % exists with different data',
        c_trial_id;
    end if;
  else
    insert into public.organization_trials (
      id,
      organization_id,
      legal_identity_hash,
      trial_scope,
      status,
      started_at,
      ends_at
    ) values (
      c_trial_id,
      c_org_id,
      c_legal_hash,
      'full_platform',
      'trialing',
      now(),
      now() + interval '60 days'
    );
  end if;

  -- ----- 5. organization_modules -----
  if exists (
    select 1
    from public.organization_modules
    where organization_id = c_org_id
      and module_id = c_module_id
      and id <> c_om_id
  ) then
    raise exception
      'F2B1 fixture conflict: organization_modules already has a different tax-advisory row for this org';
  end if;

  if exists (
    select 1 from public.organization_modules where id = c_om_id
  ) then
    if not exists (
      select 1
      from public.organization_modules
      where id = c_om_id
        and organization_id = c_org_id
        and module_id = c_module_id
        and status = 'active'
        and organization_module_subscription_id is null
    ) then
      raise exception
        'F2B1 fixture conflict: organization_modules % exists with different data',
        c_om_id;
    end if;
  else
    insert into public.organization_modules (
      id,
      organization_id,
      module_id,
      status,
      organization_module_subscription_id
    ) values (
      c_om_id,
      c_org_id,
      c_module_id,
      'active',
      null
    );
  end if;

  -- ----- 6. clients -----
  if exists (
    select 1
    from public.clients
    where organization_id = c_org_id
      and tax_id = 'F2B1-DEV-0001'
      and id <> c_client_id
  ) then
    raise exception
      'F2B1 fixture conflict: clients already has a different row for this org+tax_id';
  end if;

  if exists (
    select 1 from public.clients where id = c_client_id
  ) then
    if not exists (
      select 1
      from public.clients
      where id = c_client_id
        and organization_id = c_org_id
        and tax_id = 'F2B1-DEV-0001'
        and display_name = 'F2B1 Smoke Client'
        and created_by = v_user_id
        and client_type = 'business_customer'
        and status = 'active'
        and is_archived = false
        and country_code is null
    ) then
      raise exception
        'F2B1 fixture conflict: clients % exists with different data',
        c_client_id;
    end if;
  else
    insert into public.clients (
      id,
      organization_id,
      tax_id,
      display_name,
      created_by,
      client_type,
      status,
      is_archived,
      country_code
    ) values (
      c_client_id,
      c_org_id,
      'F2B1-DEV-0001',
      'F2B1 Smoke Client',
      v_user_id,
      'business_customer',
      'active',
      false,
      null
    );
  end if;
end;
$fixture$;

commit;

-- =============================================================================
-- CLEANUP (commented — do not run as part of apply)
-- Removes fixture rows by deterministic IDs. Does not delete public.users
-- or auth.users. Child tables also cascade from organizations.
-- =============================================================================
-- begin;
-- delete from public.clients
--   where id = 'd1000000-0000-4000-8000-000000000006';
-- delete from public.organization_modules
--   where id = 'd1000000-0000-4000-8000-000000000005';
-- delete from public.organization_trials
--   where id = 'd1000000-0000-4000-8000-000000000004';
-- delete from public.organization_country_settings
--   where id = 'd1000000-0000-4000-8000-000000000003';
-- delete from public.organization_users
--   where id = 'd1000000-0000-4000-8000-000000000002';
-- delete from public.organizations
--   where id = 'd1000000-0000-4000-8000-000000000001';
-- commit;
