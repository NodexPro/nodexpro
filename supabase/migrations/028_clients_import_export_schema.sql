-- Client import/export: optional address/city/notes; indexes for duplicate detection (email, phone).
-- Shared client master remains organization-scoped.

alter table public.clients
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists notes text;

comment on column public.clients.address is 'Street address for import/export';
comment on column public.clients.city is 'City for import/export';
comment on column public.clients.notes is 'Free-text notes for import/export';

-- Duplicate detection and export filters (org-scoped)
create index if not exists idx_clients_org_email on public.clients(organization_id, email) where email is not null;
create index if not exists idx_clients_org_phone on public.clients(organization_id, phone) where phone is not null;
