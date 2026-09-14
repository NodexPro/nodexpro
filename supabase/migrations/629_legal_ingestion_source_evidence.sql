-- TAX-629 — Knowledge Trainer source-span + source-note evidence (staging).
-- Tax Brain reserved migration range: 600–699.
-- DEV-only apply: Supabase project jgxezhjctrgfbmmkqqhn / branch develop.
-- Do not apply to production.
--
-- ADDITIVE ONLY. Does not drop, rewrite, or edit migrations 620–628.
-- Does not alter ownership of:
--   tax_domains, tax_sources, tax_legal_nodes, tax_rules, tax_rule_versions,
--   country_legal_values, country_legal_value_versions, tax_fact_definitions,
--   tax_rule_relationships, tax_rule_unresolved_legal_references.
-- Does not insert, accept, or activate canonical law.
-- Does not backfill or rewrite the active structure run.
-- Existing legal_ingestion_candidates rows stay valid with null source spans.
--
-- Purpose:
--   1. Persist backend-owned source location evidence for structure candidates
--      (distinct from page_start/page_end legal unit range).
--   2. Preserve footnote/apparatus/source-note evidence separately from structure.
-- Original ingestion evidence is immutable. Owner later edits DRAFT interpretation,
-- not these rows.

alter table public.legal_ingestion_candidates
  add column if not exists source_page integer null;

alter table public.legal_ingestion_candidates
  add column if not exists source_item_start integer null;

alter table public.legal_ingestion_candidates
  add column if not exists source_item_end integer null;

alter table public.legal_ingestion_candidates
  add column if not exists source_line_index integer null;

alter table public.legal_ingestion_candidates
  add column if not exists source_bbox jsonb null;

alter table public.legal_ingestion_candidates
  drop constraint if exists legal_ingestion_candidates_source_page_check;
alter table public.legal_ingestion_candidates
  add constraint legal_ingestion_candidates_source_page_check
  check (source_page is null or source_page > 0);

alter table public.legal_ingestion_candidates
  drop constraint if exists legal_ingestion_candidates_source_item_span_check;
alter table public.legal_ingestion_candidates
  add constraint legal_ingestion_candidates_source_item_span_check
  check (
    source_item_start is null
    or source_item_end is null
    or source_item_end >= source_item_start
  );

alter table public.legal_ingestion_candidates
  drop constraint if exists legal_ingestion_candidates_source_line_index_check;
alter table public.legal_ingestion_candidates
  add constraint legal_ingestion_candidates_source_line_index_check
  check (source_line_index is null or source_line_index >= 0);

alter table public.legal_ingestion_candidates
  drop constraint if exists legal_ingestion_candidates_source_bbox_check;
alter table public.legal_ingestion_candidates
  add constraint legal_ingestion_candidates_source_bbox_check
  check (
    source_bbox is null
    or (
      jsonb_typeof(source_bbox) = 'object'
      and source_bbox ? 'x'
      and source_bbox ? 'y'
      and source_bbox ? 'w'
      and source_bbox ? 'h'
    )
  );

comment on column public.legal_ingestion_candidates.source_page is
  'TAX-629 exact source page of the detected structure marker/title. Distinct from page_start/page_end legal unit range. Null on pre-629 rows.';
comment on column public.legal_ingestion_candidates.source_item_start is
  'TAX-629 inclusive page_text_items index where this marker/title was derived. Null on pre-629 rows. Not a character offset.';
comment on column public.legal_ingestion_candidates.source_item_end is
  'TAX-629 inclusive page_text_items index where this marker/title was derived. Null on pre-629 rows. Not a character offset.';
comment on column public.legal_ingestion_candidates.source_line_index is
  'TAX-629 grouped layout line identity on source_page. Null on pre-629 rows.';
comment on column public.legal_ingestion_candidates.source_bbox is
  'TAX-629 optional PDF.js page-space bbox {x,y,w,h} of the source line. Backend geometry, not frontend coordinates.';

create table if not exists public.legal_ingestion_source_notes (
  id uuid primary key default gen_random_uuid(),
  structure_run_id uuid not null references public.legal_ingestion_structure_runs(id) on delete restrict,
  job_id uuid not null references public.legal_ingestion_jobs(id) on delete restrict,
  document_id uuid not null references public.legal_ingestion_documents(id) on delete restrict,
  country_code char(2) not null references public.countries(code) on delete restrict,
  tax_source_id uuid not null,
  source_page integer not null check (source_page > 0),
  source_item_start integer null,
  source_item_end integer null,
  source_line_index integer null check (source_line_index is null or source_line_index >= 0),
  source_bbox jsonb null,
  printed_marker text null,
  note_text text not null,
  classification text not null,
  origin_zone text not null,
  review_status text not null,
  inline_link_status text not null,
  confidence numeric null,
  validation_warnings jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_by uuid null,
  created_at timestamptz not null default now(),
  check (btrim(note_text) <> ''),
  check (printed_marker is null or btrim(printed_marker) <> ''),
  check (
    source_item_start is null
    or source_item_end is null
    or source_item_end >= source_item_start
  ),
  check (
    source_bbox is null
    or (
      jsonb_typeof(source_bbox) = 'object'
      and source_bbox ? 'x'
      and source_bbox ? 'y'
      and source_bbox ? 'w'
      and source_bbox ? 'h'
    )
  ),
  check (
    classification in (
      'unknown',
      'legal_reference_candidate',
      'amendment_history',
      'publication_citation',
      'editorial_note',
      'other'
    )
  ),
  check (origin_zone in ('apparatus_zone', 'body_line', 'footer_line')),
  check (review_status in ('needs_review', 'unresolved')),
  check (inline_link_status in ('linked', 'unresolved', 'missing_anchor')),
  foreign key (tax_source_id, country_code)
    references public.tax_sources (id, country_code)
    on delete restrict
);

comment on table public.legal_ingestion_source_notes is
  'TAX-629 immutable Trainer source-note/apparatus evidence. Not structure. Not canonical law. Not tax_rule_unresolved_legal_references. Classification is evidence-only and is not relationship_intent.';

comment on column public.legal_ingestion_source_notes.classification is
  'Conservative evidence class. Not a resolved legal-reference type. Not tax_rule_relationships.relationship_intent.';
comment on column public.legal_ingestion_source_notes.note_text is
  'Exact extracted source-note text. Immutable original evidence.';
comment on column public.legal_ingestion_source_notes.inline_link_status is
  'linked = unique high-confidence same-page marker; unresolved = marker/note exist but link not proven; missing_anchor = note preserved without an inline marker.';

create index if not exists idx_legal_ingestion_source_notes_run
  on public.legal_ingestion_source_notes (structure_run_id, sort_order, created_at);

create index if not exists idx_legal_ingestion_source_notes_job_page
  on public.legal_ingestion_source_notes (job_id, source_page, sort_order);

create table if not exists public.legal_ingestion_source_note_anchors (
  id uuid primary key default gen_random_uuid(),
  structure_run_id uuid not null references public.legal_ingestion_structure_runs(id) on delete restrict,
  source_note_id uuid null references public.legal_ingestion_source_notes(id) on delete restrict,
  job_id uuid not null references public.legal_ingestion_jobs(id) on delete restrict,
  document_id uuid not null references public.legal_ingestion_documents(id) on delete restrict,
  country_code char(2) not null references public.countries(code) on delete restrict,
  tax_source_id uuid not null,
  source_page integer not null check (source_page > 0),
  source_item_start integer null,
  source_item_end integer null,
  source_line_index integer null check (source_line_index is null or source_line_index >= 0),
  source_bbox jsonb null,
  printed_marker text not null,
  link_status text not null,
  confidence numeric null,
  created_at timestamptz not null default now(),
  check (btrim(printed_marker) <> ''),
  check (
    source_item_start is null
    or source_item_end is null
    or source_item_end >= source_item_start
  ),
  check (
    source_bbox is null
    or (
      jsonb_typeof(source_bbox) = 'object'
      and source_bbox ? 'x'
      and source_bbox ? 'y'
      and source_bbox ? 'w'
      and source_bbox ? 'h'
    )
  ),
  check (link_status in ('linked', 'unresolved')),
  check (link_status <> 'linked' or source_note_id is not null),
  foreign key (tax_source_id, country_code)
    references public.tax_sources (id, country_code)
    on delete restrict
);

comment on table public.legal_ingestion_source_note_anchors is
  'TAX-629 optional inline footnote/reference-marker evidence. Linked to a source note only when confidence is sufficient. Unlinked markers stay unresolved. Missing anchors never drop the source note.';

create index if not exists idx_legal_ingestion_source_note_anchors_run
  on public.legal_ingestion_source_note_anchors (structure_run_id, source_page, created_at);

create index if not exists idx_legal_ingestion_source_note_anchors_note
  on public.legal_ingestion_source_note_anchors (source_note_id);

create or replace function public.legal_ingestion_source_evidence_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'legal_ingestion source evidence is immutable';
end;
$$;

drop trigger if exists legal_ingestion_source_notes_immutable on public.legal_ingestion_source_notes;
create trigger legal_ingestion_source_notes_immutable
  before update or delete on public.legal_ingestion_source_notes
  for each row execute function public.legal_ingestion_source_evidence_immutable();

drop trigger if exists legal_ingestion_source_note_anchors_immutable on public.legal_ingestion_source_note_anchors;
create trigger legal_ingestion_source_note_anchors_immutable
  before update or delete on public.legal_ingestion_source_note_anchors
  for each row execute function public.legal_ingestion_source_evidence_immutable();

alter table public.legal_ingestion_source_notes enable row level security;
alter table public.legal_ingestion_source_notes force row level security;
alter table public.legal_ingestion_source_note_anchors enable row level security;
alter table public.legal_ingestion_source_note_anchors force row level security;

revoke all on table public.legal_ingestion_source_notes from anon, authenticated, public;
revoke all on table public.legal_ingestion_source_note_anchors from anon, authenticated, public;

grant select, insert on table public.legal_ingestion_source_notes to service_role;
grant select, insert on table public.legal_ingestion_source_note_anchors to service_role;
