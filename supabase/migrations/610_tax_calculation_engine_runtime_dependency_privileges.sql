-- TAX-K4D — runtime dependency SELECT for SECURITY INVOKER persist.
-- Tax Brain reserved migration range: 600–699.
-- Scope: grant service_role SELECT on country_legal_value_versions only.
-- Required by tax_calculation_run_child_guard when inserting run legal-value pins.
-- Does not alter 600–609, RLS, policies, ownership, functions, or default privileges.
-- Does not re-grant 163/606/607 privileges.

grant select on table public.country_legal_value_versions to service_role;
