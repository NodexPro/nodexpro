-- INC-8 — persist due_date on issued income documents for Work Engine overdue signals.

alter table public.income_documents
  add column if not exists due_date date null;

create index if not exists idx_income_documents_org_due_date_overdue
  on public.income_documents (organization_id, due_date)
  where document_status = 'issued' and due_date is not null and represented_client_id is not null;
