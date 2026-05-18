-- INC-3: extend income document drafts for creation schema (operational / preview only).

alter table public.income_document_drafts
  add column if not exists payment_terms_json jsonb null,
  add column if not exists due_date date null,
  add column if not exists payment_received_json jsonb null,
  add column if not exists notes text null,
  add column if not exists currency text null default 'ILS',
  add column if not exists language text not null default 'he',
  add column if not exists validation_warnings_json jsonb null;
