-- מס הכנסה ניכויים — תדירות דיווח (same codes as מקדמות)
alter table public.client_tax_settings
  add column if not exists income_tax_deductions_frequency text null
  check (
    income_tax_deductions_frequency is null
    or income_tax_deductions_frequency in ('monthly', 'bi_monthly')
  );

comment on column public.client_tax_settings.income_tax_deductions_frequency is 'דיווח תיק ניכויים: חד חודשי / דו חודשי';
