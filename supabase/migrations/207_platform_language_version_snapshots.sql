-- Published translation snapshots for Owner Languages rollback.
-- Additive. Does not rewrite existing published values or tenant data.

alter table public.platform_language_versions
  add column if not exists snapshot jsonb not null default '{}'::jsonb;

comment on column public.platform_language_versions.snapshot is
  'Frozen published UI catalog for this version. Runtime overlay and rollback read this snapshot so a later draft cannot hide the last published text.';
