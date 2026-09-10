-- TAX-F2B1 — entitlement-path service_role SELECT privileges.
-- Tax Brain reserved migration range: 600–699.
-- Scope: minimum grants for resolveEntitlement + hasValidTrial after 008/010.
-- Does not alter 008, 010, 013, 600–616, RLS, policies, ownership, functions, or default privileges.
-- Does not grant organization_legal_identities, module_plans, module_plan_limits,
-- organizations, authenticated, anon, or PUBLIC.

grant select on table public.organization_module_subscriptions to service_role;

grant select on table public.organization_trials to service_role;
