-- TAX-628 — Additive printed local legal marker for staging and canonical structure.
-- Tax Brain reserved migration range: 600–699.
-- DEV-only apply: Supabase project jgxezhjctrgfbmmkqqhn / branch develop.
-- Do not apply to production.
--
-- ADDITIVE ONLY. Does not drop, rewrite, or backfill:
--   migrations 620–627,
--   node_number,
--   source_display_identifier,
--   normalized_machine_identifier,
--   identifier parsed components,
--   legal_ingestion_structure_runs,
--   existing legal_ingestion_candidates rows,
--   existing tax_legal_nodes rows.
-- Does not insert canonical law. Does not accept or activate anything.
-- Does not change uniqueness: printed_marker is presentation/source evidence only.
-- Existing rows stay valid with null printed_marker.

alter table public.legal_ingestion_candidates
  add column if not exists printed_marker text null;

alter table public.tax_legal_nodes
  add column if not exists printed_marker text null;

alter table public.legal_ingestion_candidates
  drop constraint if exists legal_ingestion_candidates_printed_marker_check;
alter table public.legal_ingestion_candidates
  add constraint legal_ingestion_candidates_printed_marker_check
  check (printed_marker is null or btrim(printed_marker) <> '');

alter table public.tax_legal_nodes
  drop constraint if exists tax_legal_nodes_printed_marker_check;
alter table public.tax_legal_nodes
  add constraint tax_legal_nodes_printed_marker_check
  check (printed_marker is null or btrim(printed_marker) <> '');

comment on column public.legal_ingestion_candidates.printed_marker is
  'TAX-628 exact local marker printed at this level, e.g. (1) or 4א. Null on legacy rows. Not part of identity.';
comment on column public.tax_legal_nodes.printed_marker is
  'TAX-628 exact local marker printed at this level, e.g. (1) or 4א. Null on legacy rows. Not part of identity.';
