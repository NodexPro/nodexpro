-- Payment provider commercial catalog for Platform Owner.
-- Visibility and commercial terms are independent of adapter_status.
-- Hiding a provider from Billing must not disable existing office connections.
-- Adapter readiness stays catalog_only until a signed backend adapter exists.

alter table public.payment_provider_catalog
  add column if not exists display_name_he text not null default '',
  add column if not exists logo_url text not null default '',
  add column if not exists description_en text not null default '',
  add column if not exists description_he text not null default '',
  add column if not exists show_in_billing boolean not null default true,
  add column if not exists allow_new_connections boolean not null default false,
  add column if not exists commission_percent numeric(8,4) null,
  add column if not exists connection_fee_amount numeric(12,2) null,
  add column if not exists monthly_fee_amount numeric(12,2) null,
  add column if not exists fee_currency char(3) not null default 'ILS',
  add column if not exists payout_terms_en text not null default '',
  add column if not exists payout_terms_he text not null default '',
  add column if not exists terms_url text not null default '';

alter table public.organization_payment_connections
  add column if not exists last_verify_ok boolean not null default false,
  add column if not exists last_verified_at timestamptz null;

insert into public.payment_provider_catalog (
  code, display_name, display_name_he, adapter_status, supported_scenarios, supported_countries, notes,
  show_in_billing, allow_new_connections
) values
  ('hyp', 'HYP', 'HYP', 'catalog_only', array['PLATFORM_BILLING','OFFICE_EXTERNAL','OFFICE_EMBEDDED'], array['IL'], 'Listed only. No signed adapter.', true, false),
  ('max', 'MAX', 'MAX', 'catalog_only', array['PLATFORM_BILLING','OFFICE_EXTERNAL','OFFICE_EMBEDDED'], array['IL'], 'Listed only. No signed adapter.', true, false)
on conflict (code) do nothing;

comment on column public.payment_provider_catalog.show_in_billing is
  'Office Billing catalog visibility. Existing connections stay usable when false.';
comment on column public.payment_provider_catalog.allow_new_connections is
  'Allows new office connections only when the signed adapter is ready.';
comment on column public.payment_provider_catalog.adapter_status is
  'Technical adapter readiness. Cannot be flipped to ready by a visibility toggle.';
