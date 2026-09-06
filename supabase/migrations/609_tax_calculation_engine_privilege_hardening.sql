-- TAX-K4D — privilege hardening after 608 apply.
-- Tax Brain reserved migration range: 600–699.
-- Scope: normalize ACLs on the 8 K4D tables and persist RPC only.
-- Does not alter migrations 600–608 objects, RLS, policies, ownership,
-- triggers, functions, or schema semantics.
-- Does not change platform default privileges.

revoke all on table public.tax_calculation_definitions from public, anon, authenticated, service_role;
revoke all on table public.tax_calculation_definition_versions from public, anon, authenticated, service_role;
revoke all on table public.tax_calculation_definition_rule_pins from public, anon, authenticated, service_role;
revoke all on table public.tax_calculation_definition_legal_value_requirements from public, anon, authenticated, service_role;
revoke all on table public.tax_calculation_runs from public, anon, authenticated, service_role;
revoke all on table public.tax_calculation_run_rule_pins from public, anon, authenticated, service_role;
revoke all on table public.tax_calculation_run_legal_value_pins from public, anon, authenticated, service_role;
revoke all on table public.tax_calculation_run_basis_pins from public, anon, authenticated, service_role;

grant select, insert, update, delete on table
  public.tax_calculation_definitions,
  public.tax_calculation_definition_versions,
  public.tax_calculation_definition_rule_pins,
  public.tax_calculation_definition_legal_value_requirements
  to service_role;

grant select, insert on table
  public.tax_calculation_runs,
  public.tax_calculation_run_rule_pins,
  public.tax_calculation_run_legal_value_pins,
  public.tax_calculation_run_basis_pins
  to service_role;

revoke all on function public.tax_calculation_persist_run(jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function public.tax_calculation_persist_run(jsonb, jsonb, jsonb, jsonb) from anon, authenticated;
grant execute on function public.tax_calculation_persist_run(jsonb, jsonb, jsonb, jsonb) to service_role;
