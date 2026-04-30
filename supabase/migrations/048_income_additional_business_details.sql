-- Income block: additional business details when source "business" is selected

alter table public.client_accounting_settings
  add column if not exists additional_business_type text null,
  add column if not exists additional_business_tax_id text null;

alter table public.client_accounting_settings
  drop constraint if exists client_accounting_settings_additional_business_type_enum,
  drop constraint if exists client_accounting_settings_additional_business_tax_id_len;

alter table public.client_accounting_settings
  add constraint client_accounting_settings_additional_business_type_enum
    check (
      additional_business_type is null
      or additional_business_type in ('company', 'osek_murshe', 'osek_patur')
    ),
  add constraint client_accounting_settings_additional_business_tax_id_len
    check (additional_business_tax_id is null or char_length(additional_business_tax_id) <= 50);

