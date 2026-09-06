-- Country Pack privilege hardening for legal-value versions.
-- Scope: normalize ACL on public.country_legal_value_versions only.
-- Does not alter 086/163/600–610, RLS, policies, ownership, or default privileges.

revoke all on table public.country_legal_value_versions
  from public, anon, authenticated, service_role;

grant select, insert, update on table public.country_legal_value_versions
  to service_role;
