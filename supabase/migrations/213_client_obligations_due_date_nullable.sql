-- Client Operations: allow client_obligations.due_date NULL when Reporting Calendar
-- has no filing_due_date. Do not invent statutory dates (no 19/23 fallback).
-- Overdue stays false without a calendar date.
-- Idempotent. Does not rewrite statuses, payments, documents, or is_active.
--
-- Dependencies that stay valid with NULL:
--   idx_client_obligations_due (btree allows NULL)
--   VAT period file/ensure write calendar filing_due_date or NULL
--   other obligation types continue to write their known dates
--   legal overdue treats NULL as not overdue

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'client_obligations'
      and column_name = 'due_date'
      and is_nullable = 'NO'
  ) then
    alter table public.client_obligations
      alter column due_date drop not null;
  end if;
end $$;

comment on column public.client_obligations.due_date is
  'Official filing due date from Reporting Calendar; NULL when no calendar date exists. NULL is not overdue.';
