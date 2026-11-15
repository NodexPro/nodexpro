-- Client Operations: persist org-owned custom column widths (Excel-like).
-- Idempotent. Does not rewrite labels, keys, period values, or RLS.
-- Existing rows receive width_px = 160; organization_id scoping is unchanged.

alter table public.client_operations_registry_custom_columns
  add column if not exists width_px integer not null default 160;

alter table public.client_operations_registry_custom_columns
  drop constraint if exists client_operations_registry_custom_columns_width_px_check;

alter table public.client_operations_registry_custom_columns
  add constraint client_operations_registry_custom_columns_width_px_check
  check (width_px >= 96 and width_px <= 480);

comment on column public.client_operations_registry_custom_columns.width_px is
  'Org-owned Client Operations custom column width in pixels; restored from aggregate after refresh.';
