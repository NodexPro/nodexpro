-- Per-income-source details text (for allowance/other and future extension)

alter table public.client_accounting_income_sources
  add column if not exists source_details text null;

alter table public.client_accounting_income_sources
  drop constraint if exists client_accounting_income_sources_source_details_len;

alter table public.client_accounting_income_sources
  add constraint client_accounting_income_sources_source_details_len
    check (source_details is null or char_length(source_details) <= 500);

