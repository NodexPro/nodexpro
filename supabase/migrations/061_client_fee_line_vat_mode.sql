-- VAT mode per included service line (שירותים כלולים): לפני מע"מ / כולל מע"מ
alter table public.client_fee_service_lines
  add column if not exists vat_mode text not null default 'before_vat';

alter table public.client_fee_service_lines
  add constraint client_fee_service_lines_vat_mode_check
  check (vat_mode in ('before_vat', 'incl_vat'));

comment on column public.client_fee_service_lines.vat_mode is
  'before_vat = price is net; incl_vat = price includes VAT (18%).';
