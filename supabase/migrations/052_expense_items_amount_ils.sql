-- Expense lines: either business % (חשמל, מים, …) or monthly amount in ₪ (שכירות, טלפון, …).
-- Inline CHECK from 043 is typically named {table}_{column}_check
alter table public.client_accounting_expense_items
  drop constraint if exists client_accounting_expense_items_business_percent_check;

alter table public.client_accounting_expense_items
  add column if not exists monthly_amount_ils numeric(14, 2) null;

alter table public.client_accounting_expense_items
  alter column business_percent drop not null;

alter table public.client_accounting_expense_items
  add constraint client_accounting_expense_items_business_percent_range
    check (business_percent is null or (business_percent >= 0 and business_percent <= 100));

alter table public.client_accounting_expense_items
  add constraint client_accounting_expense_items_monthly_amount_non_negative
    check (monthly_amount_ils is null or monthly_amount_ils >= 0);

-- Legacy rows stored % for types that are now amount-based — drop so users re-enter as ₪.
delete from public.client_accounting_expense_items
where expense_type_code in (
  'rent',
  'phone',
  'insurance',
  'software_subscriptions',
  'bank_fees',
  'clearing_fees'
);

alter table public.client_accounting_expense_items
  add constraint client_accounting_expense_items_value_exclusive
    check (
      (business_percent is not null and monthly_amount_ils is null)
      or (business_percent is null and monthly_amount_ils is not null)
    );

comment on column public.client_accounting_expense_items.business_percent is 'אחוז הוצאה מוכר לעסק (0–100) כש־value_kind = percent';
comment on column public.client_accounting_expense_items.monthly_amount_ils is 'סכום חודשי בשקלים כש־value_kind = amount';
