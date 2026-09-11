-- Owner Legal Control aggregate — service_role SELECT privileges.
-- Tax Brain reserved migration range: 600–699.
-- Scope: minimum grants for GET /api/v1/owner/legal-control (and /api/v1/health organizations probe).
-- 616 granted INSERT on audit_log only; 616/617 explicitly did not grant organizations or module_plans.
-- Hosted projects no longer auto-grant table DML to API roles (same reason as 606/616/617).
-- Does not alter 001, 008, 616, 617, RLS, policies, ownership, functions, or default privileges.
-- Does not grant authenticated, anon, or PUBLIC.

grant select on table public.organizations to service_role;

grant select on table public.module_plans to service_role;

grant select on table public.audit_log to service_role;
