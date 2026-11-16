-- Year-scoped annual-report checklist + persisted working tax year.
-- Existing unscoped client_annual_document_rows are NOT backfilled: tab_scope is not a proven tax_year.
-- Folders continue to come from confirmed client_annual_submission_rows + submission file links.
-- TEMPORARY_COUNTRY_PACK_PENDING: working/current tax year clock stays UTC calendar year until Country Pack owns it.

alter table public.client_annual_document_rows
  add column if not exists tax_year int null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'client_annual_document_rows_tax_year_chk'
  ) then
    alter table public.client_annual_document_rows
      add constraint client_annual_document_rows_tax_year_chk
      check (tax_year is null or (tax_year >= 1990 and tax_year <= 2200));
  end if;
end $$;

alter table public.client_annual_report_profiles
  add column if not exists working_tax_year int null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'client_annual_report_profiles_working_tax_year_chk'
  ) then
    alter table public.client_annual_report_profiles
      add constraint client_annual_report_profiles_working_tax_year_chk
      check (working_tax_year is null or (working_tax_year >= 1990 and working_tax_year <= 2200));
  end if;
end $$;

-- Replace scope-only unique so system templates can exist independently per tax year
-- without colliding with historical unscoped rows.
drop index if exists public.uq_client_annual_document_rows_org_client_scope_system;

create unique index if not exists uq_client_annual_document_rows_org_client_scope_system_unscoped
  on public.client_annual_document_rows (organization_id, client_id, tab_scope, system_key)
  where tax_year is null and system_key is not null;

create unique index if not exists uq_client_annual_document_rows_org_client_scope_year_system
  on public.client_annual_document_rows (organization_id, client_id, tab_scope, tax_year, system_key)
  where tax_year is not null and system_key is not null;

create index if not exists idx_client_annual_document_rows_org_client_scope_year
  on public.client_annual_document_rows (organization_id, client_id, tab_scope, tax_year);

create index if not exists idx_client_annual_report_profiles_org_client_scope_working_year
  on public.client_annual_report_profiles (organization_id, client_id, tab_scope, working_tax_year);
