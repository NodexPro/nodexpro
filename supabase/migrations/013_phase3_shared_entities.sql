-- Phase 3: Unified shared business entities layer.
-- Client = master record keyed by tax_id (HP). All tenant-bound. Archive policy, no physical delete.

-- ========== CLIENTS ==========
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tax_id text not null,
  client_type text not null default 'business_customer' check (client_type in ('business_customer', 'individual_customer', 'supplier', 'partner', 'other')),
  display_name text not null,
  legal_name text,
  external_code text,
  country_code char(2),
  email text,
  phone text,
  status text not null default 'active' check (status in ('active', 'inactive', 'pending')),
  lifecycle_state text not null default 'lead' check (lifecycle_state in ('lead', 'prospect', 'customer', 'churned', 'archived')),
  owner_user_id uuid references public.users(id) on delete set null,
  is_archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.users(id) on delete set null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, tax_id)
);

create index idx_clients_org on public.clients(organization_id);
create index idx_clients_org_archived on public.clients(organization_id) where is_archived = false;
create index idx_clients_tax_id on public.clients(organization_id, tax_id);
create index idx_clients_owner on public.clients(owner_user_id) where owner_user_id is not null;

comment on column public.clients.tax_id is 'HP / tax ID; unique per organization; core identity';

-- ========== CLIENT_CONTACTS ==========
create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  title text,
  is_primary boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only one primary per client
create unique index idx_client_contacts_one_primary on public.client_contacts(client_id) where is_primary = true;
create index idx_client_contacts_client on public.client_contacts(client_id);
create index idx_client_contacts_org on public.client_contacts(organization_id);

-- ========== CLIENT_NOTES ==========
create table public.client_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  author_user_id uuid not null references public.users(id) on delete restrict,
  note_text text not null,
  visibility_scope text not null default 'organization' check (visibility_scope in ('organization', 'restricted', 'private')),
  is_sensitive boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_client_notes_client on public.client_notes(client_id);
create index idx_client_notes_org on public.client_notes(organization_id);

-- ========== TAGS ==========
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text,
  name text not null,
  color text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  unique(organization_id, code)
);

create index idx_tags_org on public.tags(organization_id);

-- ========== ENTITY_TAG_LINKS ==========
create table public.entity_tag_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(organization_id, entity_type, entity_id, tag_id)
);

create index idx_entity_tag_links_entity on public.entity_tag_links(organization_id, entity_type, entity_id);
create index idx_entity_tag_links_tag on public.entity_tag_links(tag_id);

-- ========== ACTIVITY_TIMELINE ==========
create table public.activity_timeline (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  event_type text not null,
  source_type text not null check (source_type in ('system', 'manual')),
  source_module text,
  actor_user_id uuid references public.users(id) on delete set null,
  visibility_scope text not null default 'organization' check (visibility_scope in ('organization', 'restricted', 'private')),
  is_sensitive boolean not null default false,
  payload_json jsonb,
  created_at timestamptz not null default now()
);

create index idx_activity_timeline_entity on public.activity_timeline(organization_id, entity_type, entity_id, created_at desc);
create index idx_activity_timeline_org on public.activity_timeline(organization_id);

-- ========== ENTITY_LINKS ==========
create table public.entity_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_entity_type text not null,
  source_entity_id uuid not null,
  target_entity_type text not null,
  target_entity_id uuid not null,
  relation_type text not null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index idx_entity_links_source on public.entity_links(organization_id, source_entity_type, source_entity_id);
create index idx_entity_links_target on public.entity_links(organization_id, target_entity_type, target_entity_id);

-- ========== ENTITY_FILE_LINKS ==========
create table public.entity_file_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  file_asset_id uuid not null references public.file_assets(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  relation_type text not null default 'attachment',
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(file_asset_id, entity_type, entity_id)
);

create index idx_entity_file_links_entity on public.entity_file_links(organization_id, entity_type, entity_id);
create index idx_entity_file_links_file on public.entity_file_links(file_asset_id);

-- ========== ENTITY_SEARCH_INDEX ==========
create table public.entity_search_index (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  search_text text not null,
  normalized_search_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, entity_type, entity_id)
);

create index idx_entity_search_org_normalized on public.entity_search_index(organization_id, normalized_search_text);
create index idx_entity_search_entity on public.entity_search_index(organization_id, entity_type, entity_id);

-- ========== UPDATED_AT TRIGGERS ==========
create trigger clients_updated_at before update on public.clients for each row execute function public.set_updated_at();
create trigger client_contacts_updated_at before update on public.client_contacts for each row execute function public.set_updated_at();
create trigger client_notes_updated_at before update on public.client_notes for each row execute function public.set_updated_at();
create trigger entity_search_index_updated_at before update on public.entity_search_index for each row execute function public.set_updated_at();

-- ========== RLS ==========
alter table public.clients enable row level security;
alter table public.client_contacts enable row level security;
alter table public.client_notes enable row level security;
alter table public.tags enable row level security;
alter table public.entity_tag_links enable row level security;
alter table public.activity_timeline enable row level security;
alter table public.entity_links enable row level security;
alter table public.entity_file_links enable row level security;
alter table public.entity_search_index enable row level security;

create policy "clients_select_org_member" on public.clients for select using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "clients_insert_org_member" on public.clients for insert with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "clients_update_org_member" on public.clients for update using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "clients_delete_org_member" on public.clients for delete using (false);

create policy "client_contacts_select_org_member" on public.client_contacts for select using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "client_contacts_insert_org_member" on public.client_contacts for insert with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "client_contacts_update_org_member" on public.client_contacts for update using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "client_contacts_delete_org_member" on public.client_contacts for delete using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_notes_select_org_member" on public.client_notes for select using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "client_notes_insert_org_member" on public.client_notes for insert with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "client_notes_update_org_member" on public.client_notes for update using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "client_notes_delete_org_member" on public.client_notes for delete using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "tags_select_org_member" on public.tags for select using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "tags_insert_org_member" on public.tags for insert with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "tags_update_org_member" on public.tags for update using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "tags_delete_org_member" on public.tags for delete using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "entity_tag_links_select_org_member" on public.entity_tag_links for select using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "entity_tag_links_insert_org_member" on public.entity_tag_links for insert with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "entity_tag_links_delete_org_member" on public.entity_tag_links for delete using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "activity_timeline_select_org_member" on public.activity_timeline for select using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "activity_timeline_insert_org_member" on public.activity_timeline for insert with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "entity_links_select_org_member" on public.entity_links for select using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "entity_links_insert_org_member" on public.entity_links for insert with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "entity_links_delete_org_member" on public.entity_links for delete using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "entity_file_links_select_org_member" on public.entity_file_links for select using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "entity_file_links_insert_org_member" on public.entity_file_links for insert with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "entity_file_links_delete_org_member" on public.entity_file_links for delete using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "entity_search_index_select_org_member" on public.entity_search_index for select using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "entity_search_index_insert_org_member" on public.entity_search_index for insert with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "entity_search_index_update_org_member" on public.entity_search_index for update using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "entity_search_index_delete_org_member" on public.entity_search_index for delete using (organization_id in (select public.organizations_for_current_auth_user()));
