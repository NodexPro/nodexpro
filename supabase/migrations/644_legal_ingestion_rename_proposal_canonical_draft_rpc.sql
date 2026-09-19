-- TAX-648C1 — Rename the 643 publication RPC after PostgreSQL NAMEDATALEN truncation.
-- Tax Brain reserved migration range: 600–699.
-- Next unused 6xx after 643.
-- DEV-only apply: Supabase project jgxezhjctrgfbmmkqqhn / branch develop.
-- Do not apply to production.
--
-- 643 created:
--   legal_ingestion_apply_tax_knowledge_proposal_canonical_draft_publication
-- PostgreSQL stored that identifier as (63 chars):
--   legal_ingestion_apply_tax_knowledge_proposal_canonical_draft_pu
--
-- This migration RENAME only. It does not CREATE OR REPLACE the function,
-- does not duplicate the body, and does not change SECURITY DEFINER / search_path.
-- Privileges stay on the same function OID; revoke/grant below restate 643.

alter function public.legal_ingestion_apply_tax_knowledge_proposal_canonical_draft_pu(uuid, uuid, jsonb)
  rename to legal_ingestion_apply_tk_proposal_canonical_draft;

comment on function public.legal_ingestion_apply_tk_proposal_canonical_draft(uuid, uuid, jsonb) is
  'TAX-648C/C1 atomic B2→canonical DRAFT writer. service_role only. One transaction. Never activates. Never writes K4. Never creates facts or legal values. TAX-639/checksum/code generation remain command-layer invariants for 648B. Rename of the 643 function after NAMEDATALEN truncation.';

revoke all on function public.legal_ingestion_apply_tk_proposal_canonical_draft(uuid, uuid, jsonb) from public;
revoke all on function public.legal_ingestion_apply_tk_proposal_canonical_draft(uuid, uuid, jsonb) from anon, authenticated;
grant execute on function public.legal_ingestion_apply_tk_proposal_canonical_draft(uuid, uuid, jsonb) to service_role;
