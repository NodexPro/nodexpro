-- Portal and other non-user uploads may create file_assets without an office user row.
alter table public.file_assets
  alter column uploaded_by drop not null;

comment on column public.file_assets.uploaded_by is 'Office user who uploaded, when applicable; null for client portal uploads.';
