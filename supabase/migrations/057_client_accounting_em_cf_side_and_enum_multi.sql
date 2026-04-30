-- Expense management custom fields: enum_multi + value_selected_json for checkbox-style fields.

alter table public.client_accounting_expense_mgmt_custom_fields
  drop constraint if exists client_accounting_expense_mgmt_custom_fields_field_type_check;

alter table public.client_accounting_expense_mgmt_custom_fields
  add constraint client_accounting_expense_mgmt_custom_fields_field_type_check
  check (field_type in ('text', 'enum_single', 'boolean', 'enum_multi'));

alter table public.client_accounting_expense_mgmt_custom_fields
  add column if not exists value_selected_json jsonb null;

comment on column public.client_accounting_expense_mgmt_custom_fields.value_selected_json is 'For enum_multi: JSON array of selected option strings.';
