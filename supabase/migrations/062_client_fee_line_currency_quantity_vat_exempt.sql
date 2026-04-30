-- שורות שכ״ט: כמות, מטבע, שער לשקל; מצב מע״מ — פטור

alter table public.client_fee_service_lines
  add column if not exists quantity numeric(14, 4) not null default 1;

alter table public.client_fee_service_lines
  add column if not exists currency_code text not null default 'ILS';

alter table public.client_fee_service_lines
  add column if not exists exchange_rate_to_ils numeric(16, 8) null;

comment on column public.client_fee_service_lines.quantity is 'יחידות (חודשים/פריטים) — מכפיל למחיר יחידה';
comment on column public.client_fee_service_lines.currency_code is 'קוד מטבע ISO; מחיר יחידה במטבע זה';
comment on column public.client_fee_service_lines.exchange_rate_to_ils is '1 יחידת מטבע = X ש״ח; null כשמטבע ILS';

alter table public.client_fee_service_lines drop constraint if exists client_fee_service_lines_vat_mode_check;

alter table public.client_fee_service_lines
  add constraint client_fee_service_lines_vat_mode_check
  check (vat_mode in ('before_vat', 'incl_vat', 'vat_exempt'));
