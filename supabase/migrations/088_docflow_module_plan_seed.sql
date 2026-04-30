-- Phase 6 follow-up: seed visible commercial price for DocFlow in owner pricing aggregate.
-- Price requirement: 49 ILS per month (VAT included in business meaning; stored as catalog amount).

update public.modules
set
  is_active = true,
  is_sellable = true,
  is_system = false,
  updated_at = now()
where code = 'docflow';

insert into public.module_plans (module_id, code, name, billing_period, currency, price_amount, sort_order, is_active)
select
  m.id,
  'docflow_monthly_49',
  'DocFlow Monthly (49 ILS, VAT included)',
  'month',
  'ILS',
  49.00,
  10,
  true
from public.modules m
where m.code = 'docflow'
on conflict (module_id, code) do update
set
  name = excluded.name,
  billing_period = excluded.billing_period,
  currency = excluded.currency,
  price_amount = excluded.price_amount,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();

