-- Salary-source details in income block

alter table public.client_accounting_income_sources
  add column if not exists workplace_name text null,
  add column if not exists employment_scope text null;

alter table public.client_accounting_income_sources
  drop constraint if exists client_accounting_income_sources_workplace_name_len,
  drop constraint if exists client_accounting_income_sources_employment_scope_len;

alter table public.client_accounting_income_sources
  add constraint client_accounting_income_sources_workplace_name_len
    check (workplace_name is null or char_length(workplace_name) <= 200),
  add constraint client_accounting_income_sources_employment_scope_len
    check (employment_scope is null or char_length(employment_scope) <= 100);

