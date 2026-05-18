-- INC-7 production fix: Income API/UI uses route code `income`; commercial entitlement stays `invoice` (ILS 60).
-- Do not sell a second module card — hide legacy duplicate catalog row and point invoice module to /m/income.

-- 1) Hide duplicate sellable `income` catalog row (schema/tables from 118 remain; not a second product).
update public.modules
set
  is_sellable = false,
  is_active = false,
  default_visibility = 'hidden',
  nav_path = null,
  nav_label = null,
  name = 'Income (internal — use invoice module)',
  description = 'Superseded by commercial module code invoice. Not sold separately.'
where code = 'income';

-- 2) Rebrand commercial invoice module as Income product (pricing/subscriptions unchanged on module_id).
update public.modules
set
  name = 'Income / הכנסות',
  description = 'Income documents and issuer workspace',
  nav_path = '/m/income',
  nav_label = 'הכנסות',
  nav_order = coalesce(nav_order, 50)
where code = 'invoice';

-- 3) Merge accidental activations/subscriptions from duplicate income row → invoice (idempotent).
with income_mod as (
  select id from public.modules where code = 'income' limit 1
),
invoice_mod as (
  select id from public.modules where code = 'invoice' limit 1
)
update public.organization_modules om
set module_id = (select id from invoice_mod)
where om.module_id = (select id from income_mod)
  and exists (select 1 from income_mod)
  and exists (select 1 from invoice_mod)
  and not exists (
    select 1
    from public.organization_modules om2
    where om2.organization_id = om.organization_id
      and om2.module_id = (select id from invoice_mod)
      and om2.id <> om.id
  );

with income_mod as (
  select id from public.modules where code = 'income' limit 1
),
invoice_mod as (
  select id from public.modules where code = 'invoice' limit 1
)
delete from public.organization_modules om
using income_mod im
where om.module_id = im.id
  and exists (
    select 1
    from public.organization_modules om2
    where om2.organization_id = om.organization_id
      and om2.module_id = (select id from invoice_mod)
  );

with income_mod as (
  select id from public.modules where code = 'income' limit 1
),
invoice_mod as (
  select id from public.modules where code = 'invoice' limit 1
)
update public.organization_module_subscriptions oms
set module_id = (select id from invoice_mod)
where oms.module_id = (select id from income_mod)
  and exists (select 1 from income_mod)
  and exists (select 1 from invoice_mod)
  and not exists (
    select 1
    from public.organization_module_subscriptions oms2
    where oms2.organization_id = oms.organization_id
      and oms2.module_id = (select id from invoice_mod)
      and oms2.id <> oms.id
  );

with income_mod as (
  select id from public.modules where code = 'income' limit 1
),
invoice_mod as (
  select id from public.modules where code = 'invoice' limit 1
)
delete from public.organization_module_subscriptions oms
using income_mod im
where oms.module_id = im.id
  and exists (
    select 1
    from public.organization_module_subscriptions oms2
    where oms2.organization_id = oms.organization_id
      and oms2.module_id = (select id from invoice_mod)
  );
