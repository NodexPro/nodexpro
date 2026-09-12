-- TAX-624 — Knowledge Trainer V1 additive ingestion foundation.
-- Tax Brain reserved migration range: 600–699.
-- DEV-only apply: Supabase project jgxezhjctrgfbmmkqqhn / branch develop.
-- Do not apply to production.
--
-- ADDITIVE ONLY. Does not alter ownership or columns of:
--   tax_domains, tax_sources, tax_legal_nodes, tax_rules, tax_rule_versions,
--   country_legal_values, country_legal_value_versions, tax_fact_definitions.
-- Trainer tables are staging/evidence only. Canonical writes stay on existing commands.
--
-- Malware scanning is NOT implemented. malware_scan_status is an extension point.
-- P1 security gap before commercial production.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'owner-legal-materials',
  'owner-legal-materials',
  false,
  52428800,
  array['application/pdf', 'image/jpeg', 'image/png', 'text/plain']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.legal_ingestion_documents (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null references public.countries(code) on delete restrict,
  tax_source_id uuid not null,
  parent_legal_node_id uuid null,
  input_type text not null check (input_type in ('pdf', 'image', 'text')),
  provenance_type text not null check (provenance_type in (
    'official_law',
    'regulation',
    'circular',
    'official_guidance',
    'case_law_citation',
    'textbook',
    'professional_material',
    'other'
  )),
  original_filename text not null,
  mime_type text not null,
  byte_size integer not null check (byte_size > 0),
  content_sha256 text not null check (char_length(content_sha256) = 64),
  storage_bucket text not null default 'owner-legal-materials',
  storage_key text null,
  malware_scan_status text not null default 'not_implemented'
    check (malware_scan_status in ('not_implemented', 'pending', 'clean', 'blocked', 'error')),
  uploaded_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(original_filename) <> ''),
  check (btrim(mime_type) <> ''),
  foreign key (tax_source_id, country_code)
    references public.tax_sources (id, country_code)
    on delete restrict,
  foreign key (parent_legal_node_id, country_code)
    references public.tax_legal_nodes (id, country_code)
    on delete restrict
);

comment on table public.legal_ingestion_documents is
  'TAX-624 Owner legal training evidence. Platform/country scoped. Not file_assets. Original material is retained.';

comment on column public.legal_ingestion_documents.malware_scan_status is
  'Extension point only. V1 always not_implemented. Do not claim malware scanning exists.';

create unique index if not exists uq_legal_ingestion_documents_source_sha256
  on public.legal_ingestion_documents (country_code, tax_source_id, content_sha256);

create index if not exists idx_legal_ingestion_documents_source
  on public.legal_ingestion_documents (tax_source_id, created_at desc);

create table if not exists public.legal_ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.legal_ingestion_documents(id) on delete restrict,
  country_code char(2) not null references public.countries(code) on delete restrict,
  tax_source_id uuid not null,
  status text not null check (status in (
    'uploaded',
    'queued',
    'extracting',
    'partially_extracted',
    'ready_for_review',
    'needs_review',
    'extraction_failed',
    'reviewed',
    'cancelled'
  )),
  page_count integer not null default 0 check (page_count >= 0),
  extracted_page_count integer not null default 0 check (extracted_page_count >= 0),
  needs_ocr_page_count integer not null default 0 check (needs_ocr_page_count >= 0),
  failed_page_count integer not null default 0 check (failed_page_count >= 0),
  structure_candidate_count integer not null default 0 check (structure_candidate_count >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  last_error text null,
  started_at timestamptz null,
  finished_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tax_source_id, country_code)
    references public.tax_sources (id, country_code)
    on delete restrict
);

comment on table public.legal_ingestion_jobs is
  'TAX-624 durable extraction job. Never writes canonical legal tables.';

create index if not exists idx_legal_ingestion_jobs_document
  on public.legal_ingestion_jobs (document_id, created_at desc);

create index if not exists idx_legal_ingestion_jobs_status
  on public.legal_ingestion_jobs (status, updated_at);

create table if not exists public.legal_ingestion_pages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.legal_ingestion_jobs(id) on delete restrict,
  document_id uuid not null references public.legal_ingestion_documents(id) on delete restrict,
  country_code char(2) not null references public.countries(code) on delete restrict,
  page_no integer not null check (page_no > 0),
  status text not null check (status in ('pending', 'extracting', 'extracted', 'needs_ocr', 'failed')),
  extraction_method text null check (extraction_method in ('embedded_text', 'ocr', 'manual_text')),
  page_text text null,
  confidence numeric null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text null,
  lease_owner text null,
  lease_expires_at timestamptz null,
  processed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, page_no)
);

comment on table public.legal_ingestion_pages is
  'TAX-624 per-page checkpoint. Image/text input types later reuse the same page rows as an ordered batch.';

create index if not exists idx_legal_ingestion_pages_claim
  on public.legal_ingestion_pages (status, lease_expires_at, page_no);

create table if not exists public.legal_ingestion_candidates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.legal_ingestion_jobs(id) on delete restrict,
  document_id uuid not null references public.legal_ingestion_documents(id) on delete restrict,
  country_code char(2) not null references public.countries(code) on delete restrict,
  tax_source_id uuid not null,
  candidate_kind text not null check (candidate_kind in ('structure', 'rule', 'legal_value', 'reference', 'fact')),
  candidate_status text not null check (candidate_status in ('proposed', 'needs_review', 'accepted', 'rejected')),
  kind_label text null,
  node_number text null,
  title text null,
  parent_candidate_id uuid null references public.legal_ingestion_candidates(id) on delete restrict,
  parent_tax_legal_node_id uuid null,
  page_start integer null,
  page_end integer null,
  excerpt text null,
  confidence numeric null,
  validation_warnings jsonb not null default '[]'::jsonb,
  matched_tax_legal_node_id uuid null,
  accepted_tax_legal_node_id uuid null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (candidate_kind <> 'structure' or btrim(coalesce(kind_label, '')) <> ''),
  foreign key (tax_source_id, country_code)
    references public.tax_sources (id, country_code)
    on delete restrict,
  foreign key (parent_tax_legal_node_id, country_code)
    references public.tax_legal_nodes (id, country_code)
    on delete restrict
);

comment on table public.legal_ingestion_candidates is
  'TAX-624 non-canonical extraction candidates. V1 writes structure only. Accept must call existing create_tax_legal_node.';

create index if not exists idx_legal_ingestion_candidates_job
  on public.legal_ingestion_candidates (job_id, sort_order, created_at);

drop trigger if exists legal_ingestion_documents_updated_at on public.legal_ingestion_documents;
create trigger legal_ingestion_documents_updated_at
  before update on public.legal_ingestion_documents
  for each row execute function public.set_updated_at();

drop trigger if exists legal_ingestion_jobs_updated_at on public.legal_ingestion_jobs;
create trigger legal_ingestion_jobs_updated_at
  before update on public.legal_ingestion_jobs
  for each row execute function public.set_updated_at();

drop trigger if exists legal_ingestion_pages_updated_at on public.legal_ingestion_pages;
create trigger legal_ingestion_pages_updated_at
  before update on public.legal_ingestion_pages
  for each row execute function public.set_updated_at();

drop trigger if exists legal_ingestion_candidates_updated_at on public.legal_ingestion_candidates;
create trigger legal_ingestion_candidates_updated_at
  before update on public.legal_ingestion_candidates
  for each row execute function public.set_updated_at();

alter table public.legal_ingestion_documents enable row level security;
alter table public.legal_ingestion_documents force row level security;
alter table public.legal_ingestion_jobs enable row level security;
alter table public.legal_ingestion_jobs force row level security;
alter table public.legal_ingestion_pages enable row level security;
alter table public.legal_ingestion_pages force row level security;
alter table public.legal_ingestion_candidates enable row level security;
alter table public.legal_ingestion_candidates force row level security;

revoke all on table public.legal_ingestion_documents from anon, authenticated, public;
revoke all on table public.legal_ingestion_jobs from anon, authenticated, public;
revoke all on table public.legal_ingestion_pages from anon, authenticated, public;
revoke all on table public.legal_ingestion_candidates from anon, authenticated, public;

grant select, insert, update, delete on table
  public.legal_ingestion_documents,
  public.legal_ingestion_jobs,
  public.legal_ingestion_pages,
  public.legal_ingestion_candidates
  to service_role;

create or replace function public.legal_ingestion_claim_page(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns public.legal_ingestion_pages
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.legal_ingestion_pages;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker id is required';
  end if;

  update public.legal_ingestion_pages p
  set
    lease_owner = p_worker_id,
    lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
    status = 'extracting',
    attempt_count = p.attempt_count + 1,
    updated_at = now()
  where p.id = (
    select q.id
    from public.legal_ingestion_pages q
    where q.status in ('pending', 'failed')
      and (q.lease_expires_at is null or q.lease_expires_at < now())
    order by q.page_no
    for update skip locked
    limit 1
  )
  returning * into claimed;

  return claimed;
end;
$$;

comment on function public.legal_ingestion_claim_page(text, integer) is
  'TAX-624 atomic page lease. Worker-only. Does not write tax_legal_nodes.';

revoke all on function public.legal_ingestion_claim_page(text, integer) from public, anon, authenticated;
grant execute on function public.legal_ingestion_claim_page(text, integer) to service_role;
