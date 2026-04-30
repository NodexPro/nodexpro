-- Annual submissions: allow attaching one report file per submission row.
alter table if exists public.client_annual_submission_rows
  add column if not exists file_asset_id uuid null references public.file_assets(id) on delete set null;

create index if not exists idx_client_annual_submission_rows_file_asset
  on public.client_annual_submission_rows (organization_id, client_id, file_asset_id);
