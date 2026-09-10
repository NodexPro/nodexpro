-- TAX-F2B1 — runtime Core/Country-Pack service_role privileges.
-- Tax Brain reserved migration range: 600–699.
-- Scope: minimum service_role grants required by current F2B1 HTTP
-- (auth, module gate, Core client identity read, org country setting read, audit insert).
-- Does not alter 013, 600–615, RLS, policies, ownership, functions, or default privileges.
-- Does not re-grant 163/613/614/615 privileges.
-- Does not grant organizations, authenticated, anon, or PUBLIC.

grant select on table public.clients to service_role;

grant select, insert, update on table public.users to service_role;

grant select on table public.organization_country_settings to service_role;

grant insert on table public.audit_log to service_role;

grant select on table
  public.modules,
  public.organization_modules,
  public.organization_users,
  public.roles,
  public.permissions,
  public.role_permissions
  to service_role;
