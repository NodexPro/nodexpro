-- TAX-644B — Owner presentation translations for Layer B2 proposals.
-- Tax Brain reserved migration range: 600–699.
-- DEV-only apply: Supabase project jgxezhjctrgfbmmkqqhn / branch develop.
-- Do not apply to production.
--
-- ADDITIVE ONLY. Does not drop, rewrite, or edit migrations 620–641.
-- Does not alter proposal_json (immutable legal semantics).
-- Does not alter generation_metadata_json.
-- Does not alter Owner Drafts, evidence quotes, or canonical tax tables.
-- TAX-639 does not validate this column as legal truth.
-- Original Hebrew evidence remains in proposal_json.evidence.quotes.

alter table public.legal_ingestion_tax_knowledge_proposals
  add column if not exists owner_presentation_json jsonb null;

comment on column public.legal_ingestion_tax_knowledge_proposals.owner_presentation_json is
  'TAX-644B Owner presentation translations (he|ru|en) of the AI-extracted rule statements. OUTSIDE proposal_json. Not canonical law. Not TAX-639 legal truth. Switching locale must not regenerate the proposal. Original Hebrew evidence is not stored here.';

alter table public.legal_ingestion_tax_knowledge_proposals
  drop constraint if exists legal_ingestion_tkp_owner_presentation_obj;
alter table public.legal_ingestion_tax_knowledge_proposals
  add constraint legal_ingestion_tkp_owner_presentation_obj
  check (
    owner_presentation_json is null
    or jsonb_typeof(owner_presentation_json) = 'object'
  );
