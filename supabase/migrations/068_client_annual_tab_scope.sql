-- Add scope to reuse annual workspace model for additional tab (capital declaration)
-- without introducing new endpoints or new aggregate.

alter table if exists public.client_annual_report_profiles
  add column if not exists tab_scope text not null default 'annual_report';

alter table if exists public.client_annual_document_rows
  add column if not exists tab_scope text not null default 'annual_report';

alter table if exists public.client_annual_document_rows
  add column if not exists description_he text null;

alter table if exists public.client_annual_document_rows
  add column if not exists required boolean not null default true;

alter table if exists public.client_annual_submission_rows
  add column if not exists tab_scope text not null default 'annual_report';

alter table if exists public.client_annual_report_profiles
  add constraint client_annual_report_profiles_tab_scope_chk
  check (tab_scope in ('annual_report', 'capital_declaration'));

alter table if exists public.client_annual_document_rows
  add constraint client_annual_document_rows_tab_scope_chk
  check (tab_scope in ('annual_report', 'capital_declaration'));

alter table if exists public.client_annual_submission_rows
  add constraint client_annual_submission_rows_tab_scope_chk
  check (tab_scope in ('annual_report', 'capital_declaration'));

alter table if exists public.client_annual_report_profiles
  drop constraint if exists client_annual_report_profiles_organization_id_client_id_key;

drop index if exists public.uq_client_annual_report_profiles_org_client;
create unique index if not exists uq_client_annual_report_profiles_org_client_scope
  on public.client_annual_report_profiles (organization_id, client_id, tab_scope);

drop index if exists public.uq_client_annual_document_rows_org_client_system;
create unique index if not exists uq_client_annual_document_rows_org_client_scope_system
  on public.client_annual_document_rows (organization_id, client_id, tab_scope, system_key);

drop index if exists public.idx_client_annual_report_profiles_org_client;
create index if not exists idx_client_annual_report_profiles_org_client_scope
  on public.client_annual_report_profiles (organization_id, client_id, tab_scope);

drop index if exists public.idx_client_annual_document_rows_org_client;
create index if not exists idx_client_annual_document_rows_org_client_scope
  on public.client_annual_document_rows (organization_id, client_id, tab_scope);

drop index if exists public.idx_client_annual_submission_rows_org_client;
create index if not exists idx_client_annual_submission_rows_org_client_scope
  on public.client_annual_submission_rows (organization_id, client_id, tab_scope);
