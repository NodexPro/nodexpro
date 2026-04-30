-- Secure file access: storage_bucket for signed URL resolution, archived_at for soft-delete.
-- organization_id already exists and is NOT NULL. Index idx_file_assets_org exists.

alter table public.file_assets
  add column if not exists storage_bucket text default 'organization-assets',
  add column if not exists archived_at timestamptz;

comment on column public.file_assets.storage_bucket is 'Bucket name for signed URL generation; e.g. organization-assets, document-files';
comment on column public.file_assets.archived_at is 'When set, file is considered unavailable for new use (e.g. settings)';

create index if not exists idx_file_assets_org_archived on public.file_assets(organization_id) where archived_at is null;
