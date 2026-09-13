-- TAX-625 — Knowledge Trainer additive page layout evidence.
-- Tax Brain reserved migration range: 600–699.
-- DEV-only apply: Supabase project jgxezhjctrgfbmmkqqhn / branch develop.
-- Do not apply to production.
--
-- ADDITIVE ONLY. Does not drop or replace:
--   legal_ingestion_documents, stored PDFs, page_text, page status,
--   needs_ocr rows, legal_ingestion_candidates, tax_legal_nodes,
--   migrations 620–624, Legal Values, Fact Dictionary.
-- Worker still must not write canonical tax/legal tables.
--
-- Storage model: legal_ingestion_pages.page_text_items jsonb
-- Compact payload: { v:1, h:<pageHeight>, items:[{ i,s,x,y,w,h,fn,fs,eol,d }] }
-- Expected size for the current 312-page ordinance (~304 extracted pages):
--   ~200–500 items/page × ~120 bytes/item ≈ 8–18 MB JSON for the job.
-- Dense pages may exceed 800 items. Raw transform matrices are not stored.

alter table public.legal_ingestion_pages
  add column if not exists page_text_items jsonb null;

alter table public.legal_ingestion_pages
  add column if not exists layout_status text not null default 'not_extracted';

alter table public.legal_ingestion_pages
  drop constraint if exists legal_ingestion_pages_layout_status_check;

alter table public.legal_ingestion_pages
  add constraint legal_ingestion_pages_layout_status_check
  check (layout_status in (
    'not_extracted',
    'pending',
    'extracting',
    'ready',
    'skipped_needs_ocr',
    'failed'
  ));

alter table public.legal_ingestion_pages
  add column if not exists layout_item_count integer not null default 0
  check (layout_item_count >= 0);

alter table public.legal_ingestion_pages
  add column if not exists layout_error text null;

comment on column public.legal_ingestion_pages.page_text_items is
  'TAX-625 additive pdf.js item geometry. Never replaces page_text. Null until layout extraction.';

comment on column public.legal_ingestion_pages.layout_status is
  'TAX-625 layout checkpoint, independent of page text status. needs_ocr pages stay skipped_needs_ocr.';

create index if not exists idx_legal_ingestion_pages_layout_claim
  on public.legal_ingestion_pages (layout_status, lease_expires_at, page_no);

create or replace function public.legal_ingestion_claim_layout_page(
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
    layout_status = 'extracting',
    updated_at = now()
  where p.id = (
    select q.id
    from public.legal_ingestion_pages q
    where q.status = 'extracted'
      and q.layout_status in ('pending', 'failed', 'extracting')
      and (q.lease_expires_at is null or q.lease_expires_at < now())
    order by q.page_no
    for update skip locked
    limit 1
  )
  returning * into claimed;

  return claimed;
end;
$$;

comment on function public.legal_ingestion_claim_layout_page(text, integer) is
  'TAX-625 atomic layout-page lease. Does not change page_text or page status. Does not write tax_legal_nodes.';

revoke all on function public.legal_ingestion_claim_layout_page(text, integer) from public, anon, authenticated;
grant execute on function public.legal_ingestion_claim_layout_page(text, integer) to service_role;
