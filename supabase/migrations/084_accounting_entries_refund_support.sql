-- Accounting Base: refund/credit-note support.
-- Scope: accounting_entries constraints only.
-- No module/UI/API integration changes.

alter table if exists public.accounting_entries
  drop constraint if exists accounting_entries_entry_type_check;

alter table if exists public.accounting_entries
  add constraint accounting_entries_entry_type_check
  check (entry_type in ('income', 'expense', 'refund'));

alter table if exists public.accounting_entries
  drop constraint if exists accounting_entries_refund_outflow_chk;

alter table if exists public.accounting_entries
  add constraint accounting_entries_refund_outflow_chk
  check (entry_type <> 'refund' or direction = 'debit');
