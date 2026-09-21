-- TAX-653 — service_role grants for the TAX-652 Layer B pin table.
-- Tax Brain reserved migration range 600–699.
-- DEV-only apply: Supabase project jgxezhjctrgfbmmkqqhn / branch develop.
-- Do not apply to production.
--
-- 652 already applied on DEV. Do not re-run 652.
-- 652 created public.legal_ingestion_draft_legal_references, enabled FORCE RLS,
-- and revoked anon/authenticated. It did not grant service_role.
-- The API uses service_role. Missing GRANT made
-- loadDraftReferences throw Postgres 42501 and the whole
-- owner_legal_control_panel_aggregate return HTTP 500.
--
-- This statement is additive and idempotent. It does not change RLS,
-- constraints, or client privileges.

grant select, insert, update, delete
  on table public.legal_ingestion_draft_legal_references
  to service_role;
