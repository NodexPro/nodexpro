-- Extend clients with optional contact and address fields.
-- Validation (at least one of phone OR email) is enforced in application layer.

alter table public.clients
  add column if not exists website text,
  add column if not exists postal_code text;

comment on column public.clients.website is 'Optional website URL';
comment on column public.clients.postal_code is 'Optional postal / ZIP code';
-- address, city, country_code already exist (013, 028)
