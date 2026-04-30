alter table if exists public.client_tax_settings
  add column if not exists national_insurance_standing_order_until date null;

create index if not exists idx_client_tax_settings_ni_standing_order_until
  on public.client_tax_settings (organization_id, client_id, national_insurance_standing_order_until);
