-- Platform seller VAT legal-value KEY for NodexPro sales.
-- Idempotent: skips when the key already exists. Does not insert a rate version.

insert into public.country_legal_values (
  country_code,
  value_key,
  label,
  category,
  module_scope,
  usage_hint,
  owner_note,
  value_type,
  status
)
select
  'IL',
  'il_standard_vat_rate',
  'Israel standard VAT rate',
  'VAT',
  'nodexpro_platform_sales',
  'Statutory standard VAT for NodexPro platform sales. Version the rate from a date; do not overwrite history.',
  'Used by Platform Billing quotes (modules and extra staff seats). Not office income VAT.',
  'percentage',
  'active'
where exists (select 1 from public.countries where code = 'IL')
  and not exists (
    select 1
    from public.country_legal_values
    where country_code = 'IL'
      and value_key = 'il_standard_vat_rate'
  )
on conflict (country_code, value_key) do nothing;
