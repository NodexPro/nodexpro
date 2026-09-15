-- TAX-632 — Immutable subtree/source-region evidence on Owner legal-text drafts.
-- Tax Brain reserved migration range: 600–699.
-- DEV-only apply: Supabase project jgxezhjctrgfbmmkqqhn / branch develop.
-- Do not apply to production.
--
-- ADDITIVE ONLY. Does not drop, rewrite, or edit migration 630.
-- Does not alter 620–631 filenames. Does not recapture or UPDATE existing drafts.
-- New columns are NULL for legacy/smoke drafts created before this model.
--
-- Semantics (must remain separate):
--   original_source_*     = immutable OWN-NODE source evidence
--                           (heading → first descendant heading, else next non-descendant)
--   original_subtree_*    = immutable FULL SUBTREE source evidence
--                           (heading → next NON-DESCENDANT heading; includes descendants)
--   owner_source_*        = Owner-defined correction for OWN-NODE editable boundary
--   draft_legal_text      = Owner-editable OWN-NODE legal text
--
-- A parent such as 2(2) may have descendant text inside original_subtree_text.
-- That is immutable source evidence, not an editable copy.
-- 2(2).draft_legal_text must not duplicate 2(2)(א) / 2(2)(ב).
-- A leaf node may have identical own and subtree source regions. That is valid.
--
-- Does not insert, accept, activate, or publish canonical law.
-- Does not copy 629 source notes into this table.
-- Subtree page/item spans are the overlap keys for later TAX-629 note/reference lookup.
-- Does not store PDF bytes. Worker/detector must not write these columns.
-- Future structure rebuild cannot cascade-delete or overwrite subtree evidence
-- (structure_run_id / source_candidate_id remain ON DELETE SET NULL provenance).

alter table public.legal_ingestion_legal_text_drafts
  add column if not exists original_subtree_text text null;

alter table public.legal_ingestion_legal_text_drafts
  add column if not exists original_subtree_page_start integer null;

alter table public.legal_ingestion_legal_text_drafts
  add column if not exists original_subtree_page_end integer null;

alter table public.legal_ingestion_legal_text_drafts
  add column if not exists original_subtree_item_start integer null;

alter table public.legal_ingestion_legal_text_drafts
  add column if not exists original_subtree_item_end integer null;

alter table public.legal_ingestion_legal_text_drafts
  add column if not exists original_subtree_line_start integer null;

alter table public.legal_ingestion_legal_text_drafts
  add column if not exists original_subtree_line_end integer null;

alter table public.legal_ingestion_legal_text_drafts
  drop constraint if exists legal_ingestion_legal_text_drafts_subtree_page_start_chk;
alter table public.legal_ingestion_legal_text_drafts
  add constraint legal_ingestion_legal_text_drafts_subtree_page_start_chk
  check (
    original_subtree_page_start is null
    or original_subtree_page_start > 0
  );

alter table public.legal_ingestion_legal_text_drafts
  drop constraint if exists legal_ingestion_legal_text_drafts_subtree_page_end_chk;
alter table public.legal_ingestion_legal_text_drafts
  add constraint legal_ingestion_legal_text_drafts_subtree_page_end_chk
  check (
    original_subtree_page_end is null
    or (
      original_subtree_page_end > 0
      and (
        original_subtree_page_start is null
        or original_subtree_page_end >= original_subtree_page_start
      )
    )
  );

alter table public.legal_ingestion_legal_text_drafts
  drop constraint if exists legal_ingestion_legal_text_drafts_subtree_item_chk;
alter table public.legal_ingestion_legal_text_drafts
  add constraint legal_ingestion_legal_text_drafts_subtree_item_chk
  check (
    original_subtree_item_start is null
    or original_subtree_item_end is null
    or original_subtree_item_end >= original_subtree_item_start
  );

alter table public.legal_ingestion_legal_text_drafts
  drop constraint if exists legal_ingestion_legal_text_drafts_subtree_line_chk;
alter table public.legal_ingestion_legal_text_drafts
  add constraint legal_ingestion_legal_text_drafts_subtree_line_chk
  check (
    original_subtree_line_start is null
    or original_subtree_line_end is null
    or original_subtree_line_end >= original_subtree_line_start
  );

comment on column public.legal_ingestion_legal_text_drafts.original_source_text is
  'TAX-630/632 immutable OWN-NODE source text. Heading through first descendant heading, else next non-descendant. Distinct from original_subtree_text. Never overwrite when Owner edits draft_legal_text.';
comment on column public.legal_ingestion_legal_text_drafts.draft_legal_text is
  'TAX-630/632 Owner-editable OWN-NODE legal text. Must not duplicate descendant editable text. Distinct from original_source_text and original_subtree_text.';
comment on column public.legal_ingestion_legal_text_drafts.original_subtree_text is
  'TAX-632 immutable FULL SUBTREE source evidence for this node, including descendant legal structure, until the next non-descendant heading. NULL on legacy drafts (no backfill). Not editable. Not a copy of child draft_legal_text. Leaf nodes may equal original_source_text.';
comment on column public.legal_ingestion_legal_text_drafts.original_subtree_page_start is
  'TAX-632 immutable subtree source page start. Inclusive. Together with item/line span, sufficient for later TAX-629 note overlap lookup. NULL on legacy drafts.';
comment on column public.legal_ingestion_legal_text_drafts.original_subtree_page_end is
  'TAX-632 immutable subtree source page end. Inclusive. NULL on legacy drafts.';
comment on column public.legal_ingestion_legal_text_drafts.original_subtree_item_start is
  'TAX-632 immutable subtree source item start (page_text_items.i). NULL on legacy drafts. Never invent item 0 from page_start.';
comment on column public.legal_ingestion_legal_text_drafts.original_subtree_item_end is
  'TAX-632 immutable subtree source item end. Exclusive-end captured as last included item when known. NULL on legacy drafts.';
comment on column public.legal_ingestion_legal_text_drafts.original_subtree_line_start is
  'TAX-632 immutable subtree source line start. NULL on legacy drafts.';
comment on column public.legal_ingestion_legal_text_drafts.original_subtree_line_end is
  'TAX-632 immutable subtree source line end. NULL on legacy drafts.';

-- No original_subtree_bbox: TAX-630 already records that one PDF.js box cannot
-- represent a multi-page body. Subtree overlap uses page/item/line evidence.

create or replace function public.legal_ingestion_legal_text_drafts_original_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.original_source_text is distinct from old.original_source_text
    or new.original_source_page_start is distinct from old.original_source_page_start
    or new.original_source_page_end is distinct from old.original_source_page_end
    or new.original_source_item_start is distinct from old.original_source_item_start
    or new.original_source_item_end is distinct from old.original_source_item_end
    or new.original_source_line_start is distinct from old.original_source_line_start
    or new.original_source_line_end is distinct from old.original_source_line_end
    or new.original_source_bbox is distinct from old.original_source_bbox then
    raise exception 'legal_ingestion legal text draft original source evidence is immutable';
  end if;
  if new.original_subtree_text is distinct from old.original_subtree_text
    or new.original_subtree_page_start is distinct from old.original_subtree_page_start
    or new.original_subtree_page_end is distinct from old.original_subtree_page_end
    or new.original_subtree_item_start is distinct from old.original_subtree_item_start
    or new.original_subtree_item_end is distinct from old.original_subtree_item_end
    or new.original_subtree_line_start is distinct from old.original_subtree_line_start
    or new.original_subtree_line_end is distinct from old.original_subtree_line_end then
    raise exception 'legal_ingestion legal text draft original subtree evidence is immutable';
  end if;
  if new.structure_run_id is distinct from old.structure_run_id
    and not (old.structure_run_id is not null and new.structure_run_id is null) then
    raise exception 'structure_run_id is provenance and cannot be rebound';
  end if;
  if new.source_candidate_id is distinct from old.source_candidate_id
    and not (old.source_candidate_id is not null and new.source_candidate_id is null) then
    raise exception 'source_candidate_id is provenance and cannot be rebound';
  end if;
  return new;
end;
$$;

comment on function public.legal_ingestion_legal_text_drafts_original_immutable() is
  'TAX-630/632 freeze original_source_* and original_subtree_* after insert, including legacy NULL subtree fields. Provenance FKs may only SET NULL if the detector row is deleted; they cannot be pointed at another run/candidate. No silent recapture or backfill.';

-- Existing 630 trigger already fires this function on UPDATE. Replacing the
-- function body is enough; do not rewrite original_source_* rows.
drop trigger if exists legal_ingestion_legal_text_drafts_original_immutable on public.legal_ingestion_legal_text_drafts;
create trigger legal_ingestion_legal_text_drafts_original_immutable
  before update on public.legal_ingestion_legal_text_drafts
  for each row execute function public.legal_ingestion_legal_text_drafts_original_immutable();
