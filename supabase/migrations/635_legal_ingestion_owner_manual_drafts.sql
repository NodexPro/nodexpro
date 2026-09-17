-- TAX-635 — Owner-manual Draft origin, stable tree order, Layer B completeness.
-- Tax Brain reserved migration range: 600–699.
-- DEV-only apply: Supabase project jgxezhjctrgfbmmkqqhn / branch develop.
-- Do not apply to production.
--
-- ADDITIVE ONLY. Does not drop, rewrite, or edit migrations 620–632.
-- Does not recapture, UPDATE, or backfill existing Owner Draft text, review_status,
-- original_source_*, original_subtree_*, or provenance FKs.
-- Existing legal_ingestion_legal_text_drafts rows remain creation_origin = detector
-- via column default. owner_sort_key stays NULL (detector candidate.sort_order
-- remains authoritative).
--
-- Layers:
--   A. immutable source evidence (PDF, pages, 629 notes, detector candidates)
--   B. Owner-editable legal draft + Owner completeness confirmation  <-- this
--   C. canonical legal knowledge (tax_legal_nodes / Tax Knowledge commands)
--
-- Does not insert fake legal_ingestion_candidates.
-- Does not insert, accept, activate, or publish canonical law.
-- Does not store PDF bytes. Does not grant worker/detector ownership.
-- Does not overload review_status (still draft / needs_review / ready only).
-- Does not fabricate original_source_text.
-- Never modifies legal_ingestion_candidates.sort_order.
--
-- creation_origin is durable Draft origin. It is NOT inferred from
-- source_candidate_id. Provenance may later SET NULL; origin must not change.
-- owner_manual rows must not point at a detector candidate.

alter table public.legal_ingestion_legal_text_drafts
  add column if not exists creation_origin text not null default 'detector';

alter table public.legal_ingestion_legal_text_drafts
  drop constraint if exists legal_ingestion_legal_text_drafts_creation_origin_chk;
alter table public.legal_ingestion_legal_text_drafts
  add constraint legal_ingestion_legal_text_drafts_creation_origin_chk
  check (creation_origin in ('detector', 'owner_manual'));

alter table public.legal_ingestion_legal_text_drafts
  drop constraint if exists legal_ingestion_legal_text_drafts_manual_origin_chk;
alter table public.legal_ingestion_legal_text_drafts
  add constraint legal_ingestion_legal_text_drafts_manual_origin_chk
  check (creation_origin <> 'owner_manual' or source_candidate_id is null);

alter table public.legal_ingestion_legal_text_drafts
  add column if not exists owner_sort_key numeric null;

comment on column public.legal_ingestion_legal_text_drafts.creation_origin is
  'TAX-635 durable Draft origin: detector = created from a structure candidate; owner_manual = Owner-added missing item. Survives source_candidate_id ON DELETE SET NULL. Not review_status. Not canonical publication.';
comment on column public.legal_ingestion_legal_text_drafts.owner_sort_key is
  'TAX-635 optional Owner tree order key. NULL = detector candidate.sort_order remains authoritative. Manual rows may store a stable between-neighbors numeric (e.g. 412.5). Never rewrite candidate.sort_order.';

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
  if new.creation_origin is distinct from old.creation_origin then
    raise exception 'creation_origin is durable and cannot be changed';
  end if;
  return new;
end;
$$;

comment on function public.legal_ingestion_legal_text_drafts_original_immutable() is
  'TAX-630/632/635 freeze original_source_* and original_subtree_* after insert. Provenance FKs may only SET NULL if the detector row is deleted. creation_origin cannot change, including when source_candidate_id becomes NULL. No silent recapture or backfill.';

drop trigger if exists legal_ingestion_legal_text_drafts_original_immutable on public.legal_ingestion_legal_text_drafts;
create trigger legal_ingestion_legal_text_drafts_original_immutable
  before update on public.legal_ingestion_legal_text_drafts
  for each row execute function public.legal_ingestion_legal_text_drafts_original_immutable();

-- Composite document identity for completeness country/document FK (additive; id is already PK).
create unique index if not exists uq_legal_ingestion_documents_id_country
  on public.legal_ingestion_documents (id, country_code);

create table if not exists public.legal_ingestion_owner_completeness (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null references public.countries(code) on delete restrict,
  document_id uuid not null,
  branch_draft_id uuid null,
  confirmed_by uuid not null,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (document_id, country_code)
    references public.legal_ingestion_documents (id, country_code)
    on delete restrict
);

comment on table public.legal_ingestion_owner_completeness is
  'TAX-635 Layer B Owner confirmation that a document or Draft subtree was checked against original source for missing structure. Not review_status. Not canonical, accepted, active, or published law. Not detector evidence. Knowledge Trainer only.';
comment on column public.legal_ingestion_owner_completeness.document_id is
  'Required. Completeness is always scoped to one legal_ingestion_documents row.';
comment on column public.legal_ingestion_owner_completeness.branch_draft_id is
  'NULL = whole-document completeness confirmation. Non-null = that Owner Draft subtree only.';
comment on column public.legal_ingestion_owner_completeness.confirmed_by is
  'Owner user who confirmed. Named command later; not worker.';
comment on column public.legal_ingestion_owner_completeness.confirmed_at is
  'When the Owner confirmed. Retract via named command later; do not overload review_status.';

create unique index if not exists uq_legal_ingestion_owner_completeness_id_country
  on public.legal_ingestion_owner_completeness (id, country_code);

create unique index if not exists uq_legal_ingestion_owner_completeness_id_document
  on public.legal_ingestion_owner_completeness (id, document_id);

create unique index if not exists uq_legal_ingestion_owner_completeness_document
  on public.legal_ingestion_owner_completeness (document_id)
  where branch_draft_id is null;

create unique index if not exists uq_legal_ingestion_owner_completeness_branch
  on public.legal_ingestion_owner_completeness (document_id, branch_draft_id)
  where branch_draft_id is not null;

create index if not exists idx_legal_ingestion_owner_completeness_document
  on public.legal_ingestion_owner_completeness (document_id, confirmed_at desc);

alter table public.legal_ingestion_owner_completeness
  drop constraint if exists legal_ingestion_owner_completeness_branch_same_document_fk;
alter table public.legal_ingestion_owner_completeness
  add constraint legal_ingestion_owner_completeness_branch_same_document_fk
  foreign key (branch_draft_id, document_id)
  references public.legal_ingestion_legal_text_drafts (id, document_id)
  on delete restrict;

alter table public.legal_ingestion_owner_completeness
  drop constraint if exists legal_ingestion_owner_completeness_branch_same_country_fk;
alter table public.legal_ingestion_owner_completeness
  add constraint legal_ingestion_owner_completeness_branch_same_country_fk
  foreign key (branch_draft_id, country_code)
  references public.legal_ingestion_legal_text_drafts (id, country_code)
  on delete restrict;

create or replace function public.legal_ingestion_owner_completeness_guard_scope()
returns trigger
language plpgsql
as $$
declare
  document_country char(2);
  draft_document uuid;
  draft_country char(2);
begin
  select d.country_code into document_country
  from public.legal_ingestion_documents d
  where d.id = new.document_id;
  if document_country is null then
    raise exception 'document_id must reference an existing legal training document';
  end if;
  if document_country is distinct from new.country_code then
    raise exception 'owner completeness country_code must match the document';
  end if;
  if new.branch_draft_id is null then
    return new;
  end if;
  select t.document_id, t.country_code
    into draft_document, draft_country
  from public.legal_ingestion_legal_text_drafts t
  where t.id = new.branch_draft_id;
  if draft_document is null then
    raise exception 'branch_draft_id must reference an existing Owner Draft';
  end if;
  if draft_document is distinct from new.document_id then
    raise exception 'branch_draft_id must belong to the same document';
  end if;
  if draft_country is distinct from new.country_code then
    raise exception 'branch_draft_id must belong to the same country';
  end if;
  return new;
end;
$$;

comment on function public.legal_ingestion_owner_completeness_guard_scope() is
  'TAX-635 completeness is Knowledge Trainer Layer B: same country and document as the ingestion document; branch confirmation must point at a Draft in that document.';

drop trigger if exists legal_ingestion_owner_completeness_guard_scope on public.legal_ingestion_owner_completeness;
create trigger legal_ingestion_owner_completeness_guard_scope
  before insert or update of document_id, country_code, branch_draft_id
  on public.legal_ingestion_owner_completeness
  for each row execute function public.legal_ingestion_owner_completeness_guard_scope();

drop trigger if exists legal_ingestion_owner_completeness_updated_at on public.legal_ingestion_owner_completeness;
create trigger legal_ingestion_owner_completeness_updated_at
  before update on public.legal_ingestion_owner_completeness
  for each row execute function public.set_updated_at();

alter table public.legal_ingestion_owner_completeness enable row level security;
alter table public.legal_ingestion_owner_completeness force row level security;

revoke all on table public.legal_ingestion_owner_completeness from anon, authenticated, public;
grant select, insert, update, delete on table public.legal_ingestion_owner_completeness to service_role;
