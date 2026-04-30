-- Phase 4: Document Hub schema.
-- Document ≠ File. Document is business object; file_asset is physical storage.
-- All tables tenant-bound by organization_id.

-- ========== DOCUMENTS ==========
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_code text,
  title text,
  primary_client_id uuid references public.clients(id) on delete set null,
  document_type_code text not null default 'other' check (document_type_code in ('invoice', 'receipt', 'contract', 'statement', 'payroll_document', 'tax_document', 'other')),
  lifecycle_state text not null default 'uploaded' check (lifecycle_state in ('uploaded', 'pending_classification', 'classified', 'linked', 'reviewed', 'approved', 'rejected', 'archived', 'superseded')),
  status text not null default 'active' check (status in ('active', 'inactive', 'draft')),
  sensitivity_level text not null default 'normal' check (sensitivity_level in ('normal', 'internal', 'sensitive', 'restricted')),
  source_type text not null default 'manual' check (source_type in ('manual', 'email_import', 'api_import', 'sync')),
  source_reference text,
  current_version_id uuid,
  issue_date date,
  document_date date,
  amount_total numeric(18,2),
  currency char(3),
  external_reference text,
  is_archived boolean not null default false,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_documents_org on public.documents(organization_id);
create index idx_documents_org_archived on public.documents(organization_id) where is_archived = false;
create index idx_documents_primary_client on public.documents(primary_client_id) where primary_client_id is not null;
create index idx_documents_type on public.documents(organization_id, document_type_code);
create index idx_documents_lifecycle on public.documents(organization_id, lifecycle_state);

-- ========== DOCUMENT_VERSIONS ==========
create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  version_number int not null,
  file_asset_id uuid not null references public.file_assets(id) on delete restrict,
  original_file_name text not null,
  mime_type text,
  file_size bigint,
  checksum text,
  upload_source text not null default 'manual' check (upload_source in ('manual', 'email_import', 'api_import', 'sync')),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  is_current boolean not null default false,
  unique(document_id, version_number)
);

-- Only one current version per document
create unique index idx_document_versions_one_current on public.document_versions(document_id) where is_current = true;
create index idx_document_versions_document on public.document_versions(document_id);
create index idx_document_versions_org on public.document_versions(organization_id);
create index idx_document_versions_file on public.document_versions(file_asset_id);

-- FK from documents to current_version_id (deferred to avoid circular ref)
alter table public.documents add constraint fk_documents_current_version
  foreign key (current_version_id) references public.document_versions(id) on delete set null;

-- ========== DOCUMENT_LINKS ==========
create table public.document_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  target_entity_type text not null,
  target_entity_id uuid not null,
  relation_type text not null default 'related' check (relation_type in ('primary', 'related', 'attachment', 'reference')),
  is_primary boolean not null default false,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(organization_id, document_id, target_entity_type, target_entity_id)
);

create index idx_document_links_document on public.document_links(document_id);
create index idx_document_links_target on public.document_links(organization_id, target_entity_type, target_entity_id);
create index idx_document_links_org on public.document_links(organization_id);

-- ========== DOCUMENT_STATUS_HISTORY ==========
create table public.document_status_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid not null references public.users(id) on delete restrict,
  change_reason text,
  source_type text not null default 'manual' check (source_type in ('manual', 'system', 'import')),
  created_at timestamptz not null default now()
);

create index idx_document_status_history_document on public.document_status_history(document_id);
create index idx_document_status_history_org on public.document_status_history(organization_id);

-- ========== DOCUMENT_METADATA ==========
create table public.document_metadata (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  metadata_scope text not null default 'manual' check (metadata_scope in ('manual', 'extracted', 'system')),
  metadata_key text not null,
  metadata_value_text text,
  metadata_value_number numeric(18,4),
  metadata_value_date date,
  metadata_value_json jsonb,
  source_type text not null default 'manual' check (source_type in ('manual', 'extracted', 'system')),
  confidence_score numeric(3,2),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(document_id, metadata_scope, metadata_key)
);

create index idx_document_metadata_document on public.document_metadata(document_id);
create index idx_document_metadata_org on public.document_metadata(organization_id);

-- ========== DOCUMENT_ACTIVITY_TIMELINE ==========
create table public.document_activity_timeline (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  event_type text not null,
  source_module text not null default 'documents',
  actor_user_id uuid references public.users(id) on delete set null,
  is_sensitive boolean not null default false,
  payload_json jsonb,
  created_at timestamptz not null default now()
);

create index idx_document_activity_document on public.document_activity_timeline(document_id);
create index idx_document_activity_org on public.document_activity_timeline(organization_id);
create index idx_document_activity_created on public.document_activity_timeline(document_id, created_at desc);

-- ========== DOCUMENT_SEARCH_INDEX ==========
create table public.document_search_index (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  search_text text not null,
  normalized_search_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, document_id)
);

create index idx_document_search_org on public.document_search_index(organization_id);
create index idx_document_search_text on public.document_search_index using gin(to_tsvector('simple', normalized_search_text));

-- ========== UPDATED_AT triggers ==========
create trigger documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();
create trigger document_metadata_updated_at before update on public.document_metadata
  for each row execute function public.set_updated_at();
create trigger document_search_index_updated_at before update on public.document_search_index
  for each row execute function public.set_updated_at();

-- ========== RLS ==========
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_links enable row level security;
alter table public.document_status_history enable row level security;
alter table public.document_metadata enable row level security;
alter table public.document_activity_timeline enable row level security;
alter table public.document_search_index enable row level security;

create policy "documents_select_org_member" on public.documents for select
  using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "documents_insert_org_member" on public.documents for insert
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "documents_update_org_member" on public.documents for update
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "document_versions_select_org_member" on public.document_versions for select
  using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "document_versions_insert_org_member" on public.document_versions for insert
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "document_versions_update_org_member" on public.document_versions for update
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "document_links_select_org_member" on public.document_links for select
  using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "document_links_insert_org_member" on public.document_links for insert
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "document_links_delete_org_member" on public.document_links for delete
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "document_status_history_select_org_member" on public.document_status_history for select
  using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "document_status_history_insert_org_member" on public.document_status_history for insert
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "document_metadata_select_org_member" on public.document_metadata for select
  using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "document_metadata_insert_org_member" on public.document_metadata for insert
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "document_metadata_update_org_member" on public.document_metadata for update
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "document_activity_select_org_member" on public.document_activity_timeline for select
  using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "document_activity_insert_org_member" on public.document_activity_timeline for insert
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "document_search_select_org_member" on public.document_search_index for select
  using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "document_search_insert_org_member" on public.document_search_index for insert
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "document_search_update_org_member" on public.document_search_index for update
  using (organization_id in (select public.organizations_for_current_auth_user()));
