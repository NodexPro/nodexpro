-- Payment card scheme (visa / mastercard / …) derived at save from PAN; display-only.

alter table public.client_tax_settings
  add column if not exists vat_card_brand text null;

alter table public.client_tax_settings
  add column if not exists income_tax_card_brand text null;
