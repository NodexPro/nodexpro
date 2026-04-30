-- Fix: "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- Partial unique indexes are not valid arbiters for PostgREST .upsert(onConflict: organization_id,client_id,system_key).

drop index if exists public.uq_client_annual_document_rows_system;

create unique index if not exists uq_client_annual_document_rows_org_client_system
  on public.client_annual_document_rows (organization_id, client_id, system_key);
