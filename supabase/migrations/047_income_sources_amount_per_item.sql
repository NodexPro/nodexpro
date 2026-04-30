-- Income block: amount per selected source (not one global amount).

alter table public.client_accounting_income_sources
  add column if not exists monthly_amount numeric null;

alter table public.client_accounting_income_sources
  drop constraint if exists client_accounting_income_sources_monthly_amount_nonneg;

alter table public.client_accounting_income_sources
  add constraint client_accounting_income_sources_monthly_amount_nonneg
    check (monthly_amount is null or monthly_amount >= 0);

