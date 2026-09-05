-- TAX-K3A — service_role DML for Tax Knowledge Data API.
-- Tax Brain reserved migration range: 600–699.
-- Scope: privileges only. Does not alter migrations 600–605 objects, RLS, policies, or tenant access.
-- Required after May 2026: new projects no longer auto-grant table DML to API roles.
-- Backend service_role is the only Data API role allowed. anon/authenticated stay denied.
-- FORCE RLS remains as applied in 600/601/603. No tenant policies. No GRANT ALL. No TRUNCATE.

grant select, insert, update, delete on table
  public.tax_sources,
  public.tax_rules,
  public.tax_rule_versions,
  public.tax_rule_version_sources,
  public.tax_rule_version_legal_values,
  public.tax_rule_relationships
  to service_role;

revoke all on table public.tax_sources from anon, authenticated;
revoke all on table public.tax_rules from anon, authenticated;
revoke all on table public.tax_rule_versions from anon, authenticated;
revoke all on table public.tax_rule_version_sources from anon, authenticated;
revoke all on table public.tax_rule_version_legal_values from anon, authenticated;
revoke all on table public.tax_rule_relationships from anon, authenticated;

grant execute on function public.tax_knowledge_supersede_tax_rule_version(uuid, uuid) to service_role;
revoke all on function public.tax_knowledge_supersede_tax_rule_version(uuid, uuid) from public;
revoke all on function public.tax_knowledge_supersede_tax_rule_version(uuid, uuid) from anon, authenticated;
