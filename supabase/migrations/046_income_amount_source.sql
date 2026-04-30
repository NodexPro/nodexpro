-- Clarify estimated income attribution to a specific selected income source.

alter table public.client_accounting_settings
  add column if not exists estimated_income_source_code text null;

