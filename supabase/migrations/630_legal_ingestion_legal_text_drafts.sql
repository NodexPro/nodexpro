-- TAX-630 — Knowledge Trainer Owner legal-text drafts (staging Layer B).
-- Tax Brain reserved migration range: 600–699.
-- DEV-only apply: Supabase project jgxezhjctrgfbmmkqqhn / branch develop.
-- Do not apply to production.
--
-- ADDITIVE ONLY. Does not drop, rewrite, or edit migrations 620–629.
-- Does not alter ownership of:
--   tax_domains, tax_sources, tax_legal_nodes, tax_rules, tax_rule_versions,
--   country_legal_values, country_legal_value_versions, tax_fact_definitions,
--   tax_rule_relationships, tax_rule_unresolved_legal_references,
--   legal_ingestion_source_notes, legal_ingestion_source_note_anchors,
--   legal_ingestion_candidates, legal_ingestion_structure_runs,
--   legal_ingestion_pages.page_text / page_text_items.
-- Does not insert, accept, activate, or publish canonical law.
-- Does not copy 629 source notes. Does not store PDF bytes.
-- Worker/detector must not write this table.
--
-- Layers:
--   A. immutable source evidence (PDF, page_text, page_text_items, 629 notes)
--   B. Owner-editable legal draft  <-- this table
--   C. canonical legal knowledge (tax_legal_nodes / Tax Knowledge commands)
--
-- structure_run_id and source_candidate_id are PROVENANCE only.
-- They are not Draft identity. A future rebuild must not cascade-delete
-- or overwrite Owner drafts. Detector FKs use ON DELETE SET NULL.
-- Original captured text/spans are frozen after insert.
-- Owner-defined boundary columns are a later correction, not a rewrite of
-- the original automatic span.

create table if not exists public.legal_ingestion_legal_text_drafts (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null references public.countries(code) on delete restrict,
  document_id uuid not null references public.legal_ingestion_documents(id) on delete restrict,
  job_id uuid not null references public.legal_ingestion_jobs(id) on delete restrict,
  tax_source_id uuid not null,
  structure_run_id uuid null references public.legal_ingestion_structure_runs(id) on delete set null,
  source_candidate_id uuid null references public.legal_ingestion_candidates(id) on delete set null,
  kind_label text not null,
  source_display_identifier text null,
  normalized_machine_identifier text null,
  identifier_base_number text null,
  identifier_letter_suffix text null,
  identifier_nested_components jsonb not null default '[]'::jsonb,
  printed_marker text null,
  title text null,
  parent_draft_id uuid null,
  original_source_text text not null default '',
  draft_legal_text text not null default '',
  original_source_page_start integer null,
  original_source_page_end integer null,
  original_source_item_start integer null,
  original_source_item_end integer null,
  original_source_line_start integer null,
  original_source_line_end integer null,
  original_source_bbox jsonb null,
  owner_source_page_start integer null,
  owner_source_page_end integer null,
  owner_source_item_start integer null,
  owner_source_item_end integer null,
  owner_source_line_start integer null,
  owner_source_line_end integer null,
  owner_source_bbox jsonb null,
  text_boundary_status text not null,
  review_status text not null,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(kind_label) <> ''),
  check (parent_draft_id is null or parent_draft_id <> id),
  check (source_display_identifier is null or btrim(source_display_identifier) <> ''),
  check (normalized_machine_identifier is null or btrim(normalized_machine_identifier) <> ''),
  check (identifier_base_number is null or btrim(identifier_base_number) <> ''),
  check (identifier_letter_suffix is null or btrim(identifier_letter_suffix) <> ''),
  check (printed_marker is null or btrim(printed_marker) <> ''),
  check (title is null or btrim(title) <> ''),
  check (public.legal_identifier_nested_components_valid(identifier_nested_components)),
  check (text_boundary_status in ('certain', 'uncertain', 'owner_defined')),
  check (review_status in ('draft', 'needs_review', 'ready')),
  check (
    original_source_page_start is null
    or original_source_page_start > 0
  ),
  check (
    original_source_page_end is null
    or (
      original_source_page_end > 0
      and (
        original_source_page_start is null
        or original_source_page_end >= original_source_page_start
      )
    )
  ),
  check (
    original_source_item_start is null
    or original_source_item_end is null
    or original_source_item_end >= original_source_item_start
  ),
  check (
    original_source_line_start is null
    or original_source_line_end is null
    or original_source_line_end >= original_source_line_start
  ),
  check (
    owner_source_page_start is null
    or owner_source_page_start > 0
  ),
  check (
    owner_source_page_end is null
    or (
      owner_source_page_end > 0
      and (
        owner_source_page_start is null
        or owner_source_page_end >= owner_source_page_start
      )
    )
  ),
  check (
    owner_source_item_start is null
    or owner_source_item_end is null
    or owner_source_item_end >= owner_source_item_start
  ),
  check (
    owner_source_line_start is null
    or owner_source_line_end is null
    or owner_source_line_end >= owner_source_line_start
  ),
  check (
    original_source_bbox is null
    or (
      jsonb_typeof(original_source_bbox) = 'object'
      and original_source_bbox ? 'x'
      and original_source_bbox ? 'y'
      and original_source_bbox ? 'w'
      and original_source_bbox ? 'h'
    )
  ),
  check (
    owner_source_bbox is null
    or (
      jsonb_typeof(owner_source_bbox) = 'object'
      and owner_source_bbox ? 'x'
      and owner_source_bbox ? 'y'
      and owner_source_bbox ? 'w'
      and owner_source_bbox ? 'h'
    )
  ),
  foreign key (tax_source_id, country_code)
    references public.tax_sources (id, country_code)
    on delete restrict
);

comment on table public.legal_ingestion_legal_text_drafts is
  'TAX-630 Owner-editable legal-text draft (Layer B). Not canonical law. Not detector candidates. Not 629 source notes. Not worker-owned. Rebuild must not cascade-delete or overwrite these rows.';

comment on column public.legal_ingestion_legal_text_drafts.structure_run_id is
  'PROVENANCE only. Detector run that suggested this draft. ON DELETE SET NULL. Not Draft identity. Not hierarchy.';
comment on column public.legal_ingestion_legal_text_drafts.source_candidate_id is
  'PROVENANCE only. Detector candidate that suggested this draft. ON DELETE SET NULL. Not parent. Not Draft identity.';
comment on column public.legal_ingestion_legal_text_drafts.parent_draft_id is
  'Draft → Draft hierarchy. Not parent_candidate_id.';
comment on column public.legal_ingestion_legal_text_drafts.original_source_text is
  'Immutable snapshot of extracted source text at draft creation. Empty string means incomplete/OCR-missing evidence. Never fabricate. Never overwrite when Owner edits draft_legal_text.';
comment on column public.legal_ingestion_legal_text_drafts.draft_legal_text is
  'Owner-editable legal text. Future named commands only. Not a generic PATCH. Distinct from original_source_text.';
comment on column public.legal_ingestion_legal_text_drafts.original_source_bbox is
  'Optional heading/start-line PDF.js bbox {x,y,w,h}. One box cannot represent a multi-page body; do not pretend it does.';
comment on column public.legal_ingestion_legal_text_drafts.owner_source_page_start is
  'Owner-defined body boundary. Does not overwrite original_source_* provenance.';
comment on column public.legal_ingestion_legal_text_drafts.text_boundary_status is
  'certain = automatic span trusted; uncertain = incomplete/OCR/missing span; owner_defined = Marina set owner_source_*.';
comment on column public.legal_ingestion_legal_text_drafts.review_status is
  'Trainer review only: draft / needs_review / ready. Not canonical activation or publication.';
comment on column public.legal_ingestion_legal_text_drafts.source_display_identifier is
  'TAX-626 exact printed citation, e.g. 3(ט1) vs 3(ט)(1). Backend-parsed. Frontend must not reconstruct.';
comment on column public.legal_ingestion_legal_text_drafts.printed_marker is
  'TAX-628 local printed marker at this level, e.g. (1). Not identity.';
comment on column public.legal_ingestion_legal_text_drafts.identifier_nested_components is
  'TAX-626 ordered text components such as ["ט","1"] vs ["ט1"]. Empty array when none.';

create unique index if not exists uq_legal_ingestion_legal_text_drafts_id_country
  on public.legal_ingestion_legal_text_drafts (id, country_code);

create unique index if not exists uq_legal_ingestion_legal_text_drafts_id_document
  on public.legal_ingestion_legal_text_drafts (id, document_id);

alter table public.legal_ingestion_legal_text_drafts
  drop constraint if exists legal_ingestion_legal_text_drafts_parent_same_document_fk;
alter table public.legal_ingestion_legal_text_drafts
  add constraint legal_ingestion_legal_text_drafts_parent_same_document_fk
  foreign key (parent_draft_id, document_id)
  references public.legal_ingestion_legal_text_drafts (id, document_id)
  on delete restrict;

alter table public.legal_ingestion_legal_text_drafts
  drop constraint if exists legal_ingestion_legal_text_drafts_parent_same_country_fk;
alter table public.legal_ingestion_legal_text_drafts
  add constraint legal_ingestion_legal_text_drafts_parent_same_country_fk
  foreign key (parent_draft_id, country_code)
  references public.legal_ingestion_legal_text_drafts (id, country_code)
  on delete restrict;

create index if not exists idx_legal_ingestion_legal_text_drafts_document
  on public.legal_ingestion_legal_text_drafts (document_id, parent_draft_id, created_at);

create index if not exists idx_legal_ingestion_legal_text_drafts_job
  on public.legal_ingestion_legal_text_drafts (job_id, created_at);

create index if not exists idx_legal_ingestion_legal_text_drafts_source_candidate
  on public.legal_ingestion_legal_text_drafts (source_candidate_id)
  where source_candidate_id is not null;

create index if not exists idx_legal_ingestion_legal_text_drafts_structure_run
  on public.legal_ingestion_legal_text_drafts (structure_run_id)
  where structure_run_id is not null;

-- Identifier uniqueness is parent-aware and deferred to named commands.
-- A DB unique on (parent, kind, normalized_machine_identifier) would block
-- safe create-order (parent after child) and Owner identifier corrections.
-- Do not unique `(1)` / `(א)` globally.

drop trigger if exists legal_ingestion_legal_text_drafts_updated_at on public.legal_ingestion_legal_text_drafts;
create trigger legal_ingestion_legal_text_drafts_updated_at
  before update on public.legal_ingestion_legal_text_drafts
  for each row execute function public.set_updated_at();

create or replace function public.legal_ingestion_legal_text_drafts_guard_parent()
returns trigger
language plpgsql
as $$
declare
  walk uuid;
  hops integer := 0;
  parent_country char(2);
  parent_document uuid;
begin
  if new.parent_draft_id is null then
    return new;
  end if;
  if new.parent_draft_id = new.id then
    raise exception 'legal_ingestion_legal_text_drafts parent_draft_id cannot equal id';
  end if;
  select d.country_code, d.document_id
    into parent_country, parent_document
  from public.legal_ingestion_legal_text_drafts d
  where d.id = new.parent_draft_id;
  if parent_country is null then
    raise exception 'parent_draft_id must reference an existing draft';
  end if;
  if parent_country is distinct from new.country_code then
    raise exception 'parent_draft_id must belong to the same country';
  end if;
  if parent_document is distinct from new.document_id then
    raise exception 'parent_draft_id must belong to the same document';
  end if;
  walk := new.parent_draft_id;
  while walk is not null loop
    hops := hops + 1;
    if hops > 64 then
      raise exception 'legal_ingestion_legal_text_drafts parent chain is too deep';
    end if;
    if walk = new.id then
      raise exception 'legal_ingestion_legal_text_drafts parent_draft_id cannot create a cycle';
    end if;
    select d.parent_draft_id into walk
    from public.legal_ingestion_legal_text_drafts d
    where d.id = walk;
  end loop;
  return new;
end;
$$;

comment on function public.legal_ingestion_legal_text_drafts_guard_parent() is
  'TAX-630 parent must be another draft in the same country and document. No self-parent. No cycle.';

drop trigger if exists legal_ingestion_legal_text_drafts_guard_parent on public.legal_ingestion_legal_text_drafts;
create trigger legal_ingestion_legal_text_drafts_guard_parent
  before insert or update of parent_draft_id, id, country_code, document_id
  on public.legal_ingestion_legal_text_drafts
  for each row execute function public.legal_ingestion_legal_text_drafts_guard_parent();

create or replace function public.legal_ingestion_legal_text_drafts_guard_scope()
returns trigger
language plpgsql
as $$
declare
  job_document uuid;
  job_country char(2);
  job_source uuid;
begin
  select j.document_id, j.country_code, j.tax_source_id
    into job_document, job_country, job_source
  from public.legal_ingestion_jobs j
  where j.id = new.job_id;
  if job_document is null then
    raise exception 'job_id must reference an existing ingestion job';
  end if;
  if job_document is distinct from new.document_id
    or job_country is distinct from new.country_code
    or job_source is distinct from new.tax_source_id then
    raise exception 'legal text draft must match job country, document, and tax source';
  end if;
  return new;
end;
$$;

comment on function public.legal_ingestion_legal_text_drafts_guard_scope() is
  'TAX-630 draft scope is the ingestion job/document/country. Not a tenant legal-authoring table.';

drop trigger if exists legal_ingestion_legal_text_drafts_guard_scope on public.legal_ingestion_legal_text_drafts;
create trigger legal_ingestion_legal_text_drafts_guard_scope
  before insert or update of job_id, document_id, country_code, tax_source_id
  on public.legal_ingestion_legal_text_drafts
  for each row execute function public.legal_ingestion_legal_text_drafts_guard_scope();

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
  'TAX-630 freeze original_source_text and original spans. Provenance FKs may only SET NULL if the detector row is deleted; they cannot be pointed at another run/candidate.';

drop trigger if exists legal_ingestion_legal_text_drafts_original_immutable on public.legal_ingestion_legal_text_drafts;
create trigger legal_ingestion_legal_text_drafts_original_immutable
  before update on public.legal_ingestion_legal_text_drafts
  for each row execute function public.legal_ingestion_legal_text_drafts_original_immutable();

alter table public.legal_ingestion_legal_text_drafts enable row level security;
alter table public.legal_ingestion_legal_text_drafts force row level security;

revoke all on table public.legal_ingestion_legal_text_drafts from anon, authenticated, public;
grant select, insert, update, delete on table public.legal_ingestion_legal_text_drafts to service_role;
