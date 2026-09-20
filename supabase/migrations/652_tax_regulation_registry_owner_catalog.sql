-- TAX-652 — Owner Regulations & Orders registry catalog number + Layer B pins.
-- Tax Brain reserved migration range 600–699.
-- DEV-only apply: Supabase project jgxezhjctrgfbmmkqqhn / branch develop.
-- Do not apply to production.
--
-- Why existing schema cannot own this truth:
--   1) tax_sources.citation_ref is official citation, not the Owner book number.
--   2) tax_sources.source_code is a backend machine id.
--   3) Unique Owner ref is per category (tax_domain), so IL/תקנות מס הכנסה/17
--      and IL/תקנות מע״מ/17 must be distinct.
--   4) tax_rule_unresolved_legal_references requires from_tax_rule_version_id
--      (canonical). Layer B pins exist before Publish.
--   5) proposal_json unresolved refs require a B2 Proposal. Owner may pin from
--      Layer B even before a Proposal exists.
-- This table is a trainer pin that POINTS AT tax_sources. Canonical resolution
-- remains tax_rule_unresolved_legal_references → tax_rule_relationships.

alter table public.tax_sources
  add column if not exists owner_catalog_number text null;

alter table public.tax_sources
  add column if not exists owner_catalog_year integer null;

comment on column public.tax_sources.owner_catalog_number is
  'TAX-652 Owner navigation/catalog number from the Owner book. Not a DB identity and not an official legal identifier.';

comment on column public.tax_sources.owner_catalog_year is
  'TAX-652 Owner-entered year when known. Null when unknown. Never defaulted to today.';

alter table public.tax_sources drop constraint if exists tax_sources_owner_catalog_year_check;
alter table public.tax_sources
  add constraint tax_sources_owner_catalog_year_check
  check (owner_catalog_year is null or (owner_catalog_year >= 1800 and owner_catalog_year <= 2200));

create unique index if not exists uq_tax_sources_domain_owner_catalog
  on public.tax_sources (country_code, tax_domain_id, owner_catalog_number)
  where owner_catalog_number is not null
    and btrim(owner_catalog_number) <> ''
    and tax_domain_id is not null;

alter table public.tax_sources drop constraint if exists tax_sources_provenance_type_check;
alter table public.tax_sources
  add constraint tax_sources_provenance_type_check
  check (provenance_type in (
    'official_law',
    'regulation',
    'order',
    'circular',
    'official_guidance',
    'case_law_citation',
    'textbook',
    'professional_material',
    'other'
  ));

alter table public.legal_ingestion_documents drop constraint if exists legal_ingestion_documents_provenance_type_check;
alter table public.legal_ingestion_documents
  add constraint legal_ingestion_documents_provenance_type_check
  check (provenance_type in (
    'official_law',
    'regulation',
    'order',
    'circular',
    'official_guidance',
    'case_law_citation',
    'textbook',
    'professional_material',
    'other'
  ));

create table if not exists public.legal_ingestion_draft_legal_references (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null references public.countries(code) on delete restrict,
  legal_text_draft_id uuid not null,
  tax_source_id uuid not null,
  relationship_type text not null default 'depends_on',
  cited_instrument_kind text not null default 'regulation',
  locator_text text not null,
  locator_start integer null,
  locator_end integer null,
  confirmation_state text not null check (confirmation_state in ('owner_confirmed', 'ai_suggested')),
  creation_origin text not null check (creation_origin in ('owner_manual', 'ai_suggestion')),
  tax_knowledge_proposal_id uuid null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check (btrim(locator_text) <> ''),
  check (btrim(relationship_type) <> ''),
  check (btrim(cited_instrument_kind) <> ''),
  foreign key (legal_text_draft_id, country_code)
    references public.legal_ingestion_legal_text_drafts (id, country_code)
    on delete restrict,
  foreign key (tax_source_id, country_code)
    references public.tax_sources (id, country_code)
    on delete restrict
);

comment on table public.legal_ingestion_draft_legal_references is
  'TAX-652 Owner-confirmed Layer B pins to a regulation/order tax_source. Not canonical relationships. Resolution stays on tax_rule_unresolved_legal_references → tax_rule_relationships.';

create unique index if not exists uq_draft_legal_references_pin
  on public.legal_ingestion_draft_legal_references (legal_text_draft_id, tax_source_id, locator_text);

create index if not exists idx_draft_legal_references_draft
  on public.legal_ingestion_draft_legal_references (legal_text_draft_id, created_at);

create index if not exists idx_draft_legal_references_source
  on public.legal_ingestion_draft_legal_references (tax_source_id);

alter table public.legal_ingestion_draft_legal_references enable row level security;
alter table public.legal_ingestion_draft_legal_references force row level security;
revoke all on table public.legal_ingestion_draft_legal_references from anon, authenticated;
