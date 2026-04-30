-- שכ״ט: replace renewal period with billing day range (enum).

alter table public.client_fee_agreements
  drop column if exists renewal_period;

alter table public.client_fee_agreements
  drop column if exists renewal_period_other;

alter table public.client_fee_agreements
  add column if not exists billing_day_range text null;

alter table public.client_fee_agreements
  drop constraint if exists client_fee_agreements_billing_day_range_check;

alter table public.client_fee_agreements
  add constraint client_fee_agreements_billing_day_range_check
  check (
    billing_day_range is null
    or billing_day_range in ('1_5', '6_9', '10_14', '15_20', '21_31')
  );
