-- TAX-626 — Additive exact legal identifiers for staging and canonical structure.
-- Tax Brain reserved migration range: 600–699.
-- DEV-only apply: Supabase project jgxezhjctrgfbmmkqqhn / branch develop.
-- Do not apply to production.
--
-- ADDITIVE ONLY. Does not drop, rewrite, or backfill:
--   migrations 620–625,
--   node_number,
--   existing legal_ingestion_candidates rows,
--   existing tax_legal_nodes rows.
-- Does not insert canonical law. Does not accept or activate anything.
-- Existing rows stay valid with null identifier fields and empty nested arrays.

create or replace function public.legal_identifier_nested_components_valid(value jsonb)
returns boolean
language sql
immutable
as $$
  select
    jsonb_typeof(value) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(value) as elem
      where jsonb_typeof(elem) <> 'string'
    );
$$;

comment on function public.legal_identifier_nested_components_valid(jsonb) is
  'TAX-626 nested legal identifier components must be an ordered JSON array of text scalars.';

alter table public.legal_ingestion_candidates
  add column if not exists source_display_identifier text null;

alter table public.legal_ingestion_candidates
  add column if not exists normalized_machine_identifier text null;

alter table public.legal_ingestion_candidates
  add column if not exists identifier_base_number text null;

alter table public.legal_ingestion_candidates
  add column if not exists identifier_letter_suffix text null;

alter table public.legal_ingestion_candidates
  add column if not exists identifier_nested_components jsonb not null default '[]'::jsonb;

alter table public.tax_legal_nodes
  add column if not exists source_display_identifier text null;

alter table public.tax_legal_nodes
  add column if not exists normalized_machine_identifier text null;

alter table public.tax_legal_nodes
  add column if not exists identifier_base_number text null;

alter table public.tax_legal_nodes
  add column if not exists identifier_letter_suffix text null;

alter table public.tax_legal_nodes
  add column if not exists identifier_nested_components jsonb not null default '[]'::jsonb;

alter table public.legal_ingestion_candidates
  drop constraint if exists legal_ingestion_candidates_source_display_identifier_check;
alter table public.legal_ingestion_candidates
  add constraint legal_ingestion_candidates_source_display_identifier_check
  check (source_display_identifier is null or btrim(source_display_identifier) <> '');

alter table public.legal_ingestion_candidates
  drop constraint if exists legal_ingestion_candidates_normalized_machine_identifier_check;
alter table public.legal_ingestion_candidates
  add constraint legal_ingestion_candidates_normalized_machine_identifier_check
  check (normalized_machine_identifier is null or btrim(normalized_machine_identifier) <> '');

alter table public.legal_ingestion_candidates
  drop constraint if exists legal_ingestion_candidates_identifier_base_number_check;
alter table public.legal_ingestion_candidates
  add constraint legal_ingestion_candidates_identifier_base_number_check
  check (identifier_base_number is null or btrim(identifier_base_number) <> '');

alter table public.legal_ingestion_candidates
  drop constraint if exists legal_ingestion_candidates_identifier_letter_suffix_check;
alter table public.legal_ingestion_candidates
  add constraint legal_ingestion_candidates_identifier_letter_suffix_check
  check (identifier_letter_suffix is null or btrim(identifier_letter_suffix) <> '');

alter table public.legal_ingestion_candidates
  drop constraint if exists legal_ingestion_candidates_identifier_nested_components_check;
alter table public.legal_ingestion_candidates
  add constraint legal_ingestion_candidates_identifier_nested_components_check
  check (public.legal_identifier_nested_components_valid(identifier_nested_components));

alter table public.tax_legal_nodes
  drop constraint if exists tax_legal_nodes_source_display_identifier_check;
alter table public.tax_legal_nodes
  add constraint tax_legal_nodes_source_display_identifier_check
  check (source_display_identifier is null or btrim(source_display_identifier) <> '');

alter table public.tax_legal_nodes
  drop constraint if exists tax_legal_nodes_normalized_machine_identifier_check;
alter table public.tax_legal_nodes
  add constraint tax_legal_nodes_normalized_machine_identifier_check
  check (normalized_machine_identifier is null or btrim(normalized_machine_identifier) <> '');

alter table public.tax_legal_nodes
  drop constraint if exists tax_legal_nodes_identifier_base_number_check;
alter table public.tax_legal_nodes
  add constraint tax_legal_nodes_identifier_base_number_check
  check (identifier_base_number is null or btrim(identifier_base_number) <> '');

alter table public.tax_legal_nodes
  drop constraint if exists tax_legal_nodes_identifier_letter_suffix_check;
alter table public.tax_legal_nodes
  add constraint tax_legal_nodes_identifier_letter_suffix_check
  check (identifier_letter_suffix is null or btrim(identifier_letter_suffix) <> '');

alter table public.tax_legal_nodes
  drop constraint if exists tax_legal_nodes_identifier_nested_components_check;
alter table public.tax_legal_nodes
  add constraint tax_legal_nodes_identifier_nested_components_check
  check (public.legal_identifier_nested_components_valid(identifier_nested_components));

comment on column public.legal_ingestion_candidates.source_display_identifier is
  'TAX-626 exact printed legal citation. Null on legacy rows. Not a rewrite of node_number.';
comment on column public.legal_ingestion_candidates.normalized_machine_identifier is
  'TAX-626 deterministic match/dedup key. Parent-aware uniqueness is application-scoped for staging.';
comment on column public.legal_ingestion_candidates.identifier_nested_components is
  'TAX-626 ordered text components such as ["א","1"]. Empty array when none.';
comment on column public.tax_legal_nodes.source_display_identifier is
  'TAX-626 exact printed legal citation. Null on legacy rows. Not a rewrite of node_number.';
comment on column public.tax_legal_nodes.normalized_machine_identifier is
  'TAX-626 deterministic match/dedup key. Unique per source/parent/kind when not null.';
comment on column public.tax_legal_nodes.identifier_nested_components is
  'TAX-626 ordered text components such as ["א","1"]. Empty array when none.';

-- Parent-aware uniqueness: identical child identifiers may exist under different parents.
-- Roots use a separate partial index because UNIQUE treats NULL parents as distinct.
create unique index if not exists uq_tax_legal_nodes_child_legal_identity
  on public.tax_legal_nodes (
    country_code,
    tax_source_id,
    parent_node_id,
    tax_legal_node_kind_id,
    normalized_machine_identifier
  )
  where normalized_machine_identifier is not null
    and parent_node_id is not null;

create unique index if not exists uq_tax_legal_nodes_root_legal_identity
  on public.tax_legal_nodes (
    country_code,
    tax_source_id,
    tax_legal_node_kind_id,
    normalized_machine_identifier
  )
  where normalized_machine_identifier is not null
    and parent_node_id is null;

create index if not exists idx_legal_ingestion_candidates_job_identity
  on public.legal_ingestion_candidates (
    job_id,
    parent_candidate_id,
    kind_label,
    normalized_machine_identifier
  )
  where normalized_machine_identifier is not null;
