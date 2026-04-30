-- Client documents workspace (מסמכים): folders + documents per client; aggregate-only read, command-only write.

insert into public.permissions (code, name, domain)
values
  ('client_documents_tab.view', 'View client documents workspace', 'client_operations'),
  ('client_documents_tab.edit', 'Edit client documents workspace', 'client_operations')
on conflict (code) do nothing;

insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner', 'client_documents_tab.view'),
  ('owner', 'client_documents_tab.edit'),
  ('admin', 'client_documents_tab.view'),
  ('admin', 'client_documents_tab.edit'),
  ('staff', 'client_documents_tab.view'),
  ('staff', 'client_documents_tab.edit'),
  ('viewer', 'client_documents_tab.view')
on conflict (role_code, permission_code) do nothing;

-- Tab state: open folder + optimistic concurrency (same pattern as annual profile).
create table if not exists public.client_document_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  open_folder_id uuid null,
  read_model_version int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id) on delete set null,
  unique (organization_id, client_id)
);

create index if not exists idx_client_document_profiles_org_client
  on public.client_document_profiles (organization_id, client_id);

create trigger client_document_profiles_updated_at
  before update on public.client_document_profiles
  for each row execute function public.set_updated_at();

create table if not exists public.client_document_folders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  system_key text null,
  name_he text not null,
  sort_order int not null default 0,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- System folders: one row per (org, client, system_key).
create unique index if not exists uq_client_document_folders_org_client_system
  on public.client_document_folders (organization_id, client_id, system_key)
  where system_key is not null;

create index if not exists idx_client_document_folders_org_client
  on public.client_document_folders (organization_id, client_id);

create trigger client_document_folders_updated_at
  before update on public.client_document_folders
  for each row execute function public.set_updated_at();

-- FK from profile to folder after folders table exists (nullable; cleared if folder removed).
alter table public.client_document_profiles
  drop constraint if exists client_document_profiles_open_folder_id_fkey;

alter table public.client_document_profiles
  add constraint client_document_profiles_open_folder_id_fkey
  foreign key (open_folder_id) references public.client_document_folders(id) on delete set null;

create table if not exists public.client_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  folder_id uuid not null references public.client_document_folders(id) on delete restrict,
  file_asset_id uuid not null references public.file_assets(id) on delete restrict,
  display_label_he text null,
  uploaded_by_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists idx_client_documents_org_client
  on public.client_documents (organization_id, client_id);

create index if not exists idx_client_documents_folder
  on public.client_documents (organization_id, client_id, folder_id);

create trigger client_documents_updated_at
  before update on public.client_documents
  for each row execute function public.set_updated_at();

alter table public.client_document_profiles enable row level security;
alter table public.client_document_folders enable row level security;
alter table public.client_documents enable row level security;

create policy "client_document_profiles_select_org_member"
  on public.client_document_profiles for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_document_profiles_insert_org_member"
  on public.client_document_profiles for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_document_profiles_update_org_member"
  on public.client_document_profiles for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_document_profiles_delete_org_member"
  on public.client_document_profiles for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_document_folders_select_org_member"
  on public.client_document_folders for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_document_folders_insert_org_member"
  on public.client_document_folders for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_document_folders_update_org_member"
  on public.client_document_folders for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_document_folders_delete_org_member"
  on public.client_document_folders for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_documents_select_org_member"
  on public.client_documents for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_documents_insert_org_member"
  on public.client_documents for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_documents_update_org_member"
  on public.client_documents for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_documents_delete_org_member"
  on public.client_documents for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
