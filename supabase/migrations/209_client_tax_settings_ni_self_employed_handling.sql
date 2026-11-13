-- Additive, reversible. Do not apply to production without explicit approval.
-- Client Operations office handling method for self-employed National Insurance.
-- Not a statutory due date, bank verification, or Accounting Base payment.
-- TEMPORARY_COUNTRY_PACK_PENDING: the 15th reminder is an internal office threshold.
--
-- NULL method = unresolved historical / unselected. Do not backfill.
--
-- Rollback:
--   alter table public.client_tax_settings
--     drop constraint if exists client_tax_settings_ni_se_handling_method_check;
--   alter table public.client_tax_settings
--     drop constraint if exists client_tax_settings_ni_se_handling_year_check;
--   alter table public.client_tax_settings
--     drop column if exists national_insurance_self_employed_handling_method;
--   alter table public.client_tax_settings
--     drop column if exists national_insurance_self_employed_handling_year;

alter table if exists public.client_tax_settings
  add column if not exists national_insurance_self_employed_handling_method text null,
  add column if not exists national_insurance_self_employed_handling_year integer null;

alter table public.client_tax_settings
  drop constraint if exists client_tax_settings_ni_se_handling_method_check;

alter table public.client_tax_settings
  add constraint client_tax_settings_ni_se_handling_method_check
  check (
    national_insurance_self_employed_handling_method is null
    or national_insurance_self_employed_handling_method in (
      'standing_order',
      'client_pays',
      'manual_monthly'
    )
  );

alter table public.client_tax_settings
  drop constraint if exists client_tax_settings_ni_se_handling_year_check;

alter table public.client_tax_settings
  add constraint client_tax_settings_ni_se_handling_year_check
  check (
    national_insurance_self_employed_handling_year is null
    or (
      national_insurance_self_employed_handling_year >= 2000
      and national_insurance_self_employed_handling_year <= 2100
    )
  );

comment on column public.client_tax_settings.national_insurance_self_employed_handling_method is
  'Client Operations office handling method for self-employed NI. NULL = unresolved historical/unselected. Not bank-verified. Not Accounting Base.';

comment on column public.client_tax_settings.national_insurance_self_employed_handling_year is
  'Calendar year for which national_insurance_self_employed_handling_method was last confirmed. Does not carry into the next year.';
