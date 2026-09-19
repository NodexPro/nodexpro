-- TAX-649A Owner Knowledge Trainer workspace selection.
-- Persists the Platform Owner working document per country.
-- This is Owner workspace state only. It is not canonical legal truth.

create table if not exists public.legal_ingestion_owner_workspace_selection (
  country_code char(2) primary key references public.countries(code) on delete restrict,
  selected_document_id uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (selected_document_id, country_code)
    references public.legal_ingestion_documents (id, country_code)
    on delete restrict
);

comment on table public.legal_ingestion_owner_workspace_selection is
  'TAX-649A Owner Knowledge Trainer working document per country. Workspace state only. Not canonical law. Not written by admin/test fixture inserts.';
comment on column public.legal_ingestion_owner_workspace_selection.selected_document_id is
  'Owner-selected legal_ingestion_documents row for this country. Written only by named Owner commands.';

create index if not exists idx_legal_ingestion_owner_workspace_selection_document
  on public.legal_ingestion_owner_workspace_selection (selected_document_id);

drop trigger if exists legal_ingestion_owner_workspace_selection_updated_at
  on public.legal_ingestion_owner_workspace_selection;
create trigger legal_ingestion_owner_workspace_selection_updated_at
  before update on public.legal_ingestion_owner_workspace_selection
  for each row execute function public.set_updated_at();

alter table public.legal_ingestion_owner_workspace_selection enable row level security;
alter table public.legal_ingestion_owner_workspace_selection force row level security;

revoke all on table public.legal_ingestion_owner_workspace_selection from anon, authenticated, public;
grant select, insert, update, delete on table public.legal_ingestion_owner_workspace_selection to service_role;
