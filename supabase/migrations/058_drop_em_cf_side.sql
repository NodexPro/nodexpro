-- Expense management custom fields: remove side/צד (no longer used).

alter table public.client_accounting_expense_mgmt_custom_fields
  drop constraint if exists client_accounting_expense_mgmt_custom_fields_side_check;

alter table public.client_accounting_expense_mgmt_custom_fields
  drop column if exists side;
