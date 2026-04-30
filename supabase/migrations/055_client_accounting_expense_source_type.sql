-- מקור הוצאות (expense_source_type) for expense management section.

alter table public.client_accounting_settings
  add column if not exists expense_source_type text null;

