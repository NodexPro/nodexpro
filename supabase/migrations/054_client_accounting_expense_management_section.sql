-- Expense management / workflow section (ניהול הוצאות) — הגדרות הנה״ח, separate from recurring expense items.

alter table public.client_accounting_settings
  add column if not exists expense_delivery_method text null,
  add column if not exists expense_software_name text null,
  add column if not exists expense_software_username text null,
  add column if not exists expense_software_password_encrypted text null,
  add column if not exists expense_software_url text null,
  add column if not exists expense_uploaded_by text null,
  add column if not exists expense_documents_order_level text null,
  add column if not exists expense_management_notes text null,
  add column if not exists expense_management_version int not null default 0;

insert into public.permissions (code, name, domain)
values
  (
    'accounting_settings_expense_management.edit',
    'Edit accounting settings expense management section',
    'client_operations'
  )
on conflict (code) do nothing;

insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner', 'accounting_settings_expense_management.edit'),
  ('admin', 'accounting_settings_expense_management.edit'),
  ('staff', 'accounting_settings_expense_management.edit')
on conflict (role_code, permission_code) do nothing;
