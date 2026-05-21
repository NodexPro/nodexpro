-- INC-8.5 — IL series numbering policy metadata + draft document_date.

alter table public.income_document_numbering_sequences
  add column if not exists policy_key text null,
  add column if not exists range_start int null,
  add column if not exists range_end int null,
  add column if not exists overflow_next int null;

alter table public.income_document_drafts
  add column if not exists document_date date null;

create index if not exists idx_income_documents_issuer_type_issue_date
  on public.income_documents (organization_id, issuer_business_id, document_type, issue_date)
  where document_status = 'issued';
