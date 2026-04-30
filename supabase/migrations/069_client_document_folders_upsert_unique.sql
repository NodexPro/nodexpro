-- PostgREST upsert requires a non-partial unique constraint matching ON CONFLICT (organization_id, client_id, system_key).
-- Partial index "WHERE system_key IS NOT NULL" does not qualify (PostgreSQL: inference must match the index).
-- Full unique on (organization_id, client_id, system_key) is valid: multiple rows with system_key NULL remain allowed-- (NULLs do not collide in UNIQUE).

drop index if exists public.uq_client_document_folders_org_client_system;

create unique index if not exists uq_client_document_folders_org_client_system_key
  on public.client_document_folders (organization_id, client_id, system_key);
