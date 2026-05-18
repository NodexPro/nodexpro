-- INC-3.5: Core org business profile fields + Income issuer profile projection + Income module nav.

alter table public.organization_settings
  add column if not exists vat_registration_status text null,
  add column if not exists default_currency text null default 'ILS',
  add column if not exists default_document_language text null default 'he';

alter table public.income_issuer_profiles
  add column if not exists normalized_income_business_type text null,
  add column if not exists country_code char(2) null,
  add column if not exists vat_registration_status text null,
  add column if not exists default_currency text null default 'ILS',
  add column if not exists default_language text null default 'he',
  add column if not exists business_type_source text null;

update public.modules
set
  nav_path = '/m/income',
  nav_label = 'הכנסות',
  nav_order = coalesce(nav_order, 50)
where code = 'income'
  and (nav_path is null or nav_path = '');
