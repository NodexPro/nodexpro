-- Business profile block: add two address fields

alter table public.client_accounting_settings
  add column if not exists business_address text null,
  add column if not exists private_address text null;

alter table public.client_accounting_settings
  drop constraint if exists client_accounting_settings_business_address_len,
  drop constraint if exists client_accounting_settings_private_address_len;

alter table public.client_accounting_settings
  add constraint client_accounting_settings_business_address_len
    check (business_address is null or char_length(business_address) <= 500),
  add constraint client_accounting_settings_private_address_len
    check (private_address is null or char_length(private_address) <= 500);

