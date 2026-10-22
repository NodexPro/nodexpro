-- P0.1 follow-up — PostgREST SELECT lockdown (forward-only).
-- 191 revoked INSERT/UPDATE/DELETE/TRUNCATE. Leftover SELECT grants still let a
-- browser JWT read tenant rows that have org-member RLS policies.
-- First-party WEB uses Auth only (no .from() / storage / rpc).
-- Auth lives in auth schema; Storage lives in storage schema. Untouched.
-- Do not apply this to production automatically. Verify on disposable/staging first.

-- 1) Revoke SELECT on all public tables from PostgREST roles.
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
      'revoke select on table public.%I from anon, authenticated, public',
      r.tablename
    );
  end loop;
end
$$;

-- 2) Revoke SELECT on public views (same PostgREST surface).
do $$
declare
  r record;
begin
  for r in
    select viewname
    from pg_views
    where schemaname = 'public'
  loop
    execute format(
      'revoke select on table public.%I from anon, authenticated, public',
      r.viewname
    );
  end loop;
end
$$;

-- 3) Membership helper must not be callable as PostgREST RPC by browser JWT.
-- RLS policies that call it still work (table owner / SECURITY DEFINER).
revoke all on function public.organizations_for_current_auth_user() from anon, authenticated, public;
