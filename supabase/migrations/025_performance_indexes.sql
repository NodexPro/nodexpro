-- Performance indexes for faster queries.
-- No schema changes; indexes only.

-- entity_search_index: composite for org+entity_type+entity_id lookups
create index if not exists idx_entity_search_org_entity
  on public.entity_search_index(organization_id, entity_type);

-- activity_timeline: composite for common query pattern (entity + created_at desc)
create index if not exists idx_activity_timeline_entity_created
  on public.activity_timeline(organization_id, entity_type, entity_id, created_at desc);

-- document_versions: document lookup
create index if not exists idx_document_versions_doc_created
  on public.document_versions(document_id, created_at desc);

-- organization_memberships: status filter for active members
create index if not exists idx_organization_memberships_org_status
  on public.organization_memberships(organization_id, status) where status = 'active';

-- clients: display_name for ordering
create index if not exists idx_clients_org_display_name
  on public.clients(organization_id, display_name);

-- documents: created_at for list ordering
create index if not exists idx_documents_org_created
  on public.documents(organization_id, created_at desc);
