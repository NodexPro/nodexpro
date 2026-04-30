-- Allow חצי שנתי for income tax deductions frequency.

alter table public.client_tax_settings
  drop constraint if exists client_tax_settings_income_tax_deductions_frequency_check;

alter table public.client_tax_settings
  add constraint client_tax_settings_income_tax_deductions_frequency_check
  check (
    income_tax_deductions_frequency is null
    or income_tax_deductions_frequency in ('monthly', 'bi_monthly', 'semi_annual')
  );

comment on column public.client_tax_settings.income_tax_deductions_frequency is 'דיווח תיק ניכויים: חד חודשי / דו חודשי / חצי שנתי';
