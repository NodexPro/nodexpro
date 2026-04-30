-- Permissions for compact accounting settings tab + per-block edit.

insert into public.permissions (code, name, domain)
values
  ('accounting_settings_tab.view', 'View accounting settings tab', 'client_operations'),
  ('accounting_settings_expenses.edit', 'Edit accounting settings expenses block', 'client_operations'),
  ('accounting_settings_income.edit', 'Edit accounting settings income block', 'client_operations'),
  ('accounting_settings_documents.edit', 'Edit accounting settings documents block', 'client_operations'),
  ('accounting_settings_vehicles.edit', 'Edit accounting settings vehicles block', 'client_operations')
on conflict (code) do nothing;

insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner', 'accounting_settings_tab.view'),
  ('owner', 'accounting_settings_expenses.edit'),
  ('owner', 'accounting_settings_income.edit'),
  ('owner', 'accounting_settings_documents.edit'),
  ('owner', 'accounting_settings_vehicles.edit'),
  ('admin', 'accounting_settings_tab.view'),
  ('admin', 'accounting_settings_expenses.edit'),
  ('admin', 'accounting_settings_income.edit'),
  ('admin', 'accounting_settings_documents.edit'),
  ('admin', 'accounting_settings_vehicles.edit'),
  ('staff', 'accounting_settings_tab.view'),
  ('staff', 'accounting_settings_expenses.edit'),
  ('staff', 'accounting_settings_income.edit'),
  ('staff', 'accounting_settings_documents.edit'),
  ('staff', 'accounting_settings_vehicles.edit'),
  ('viewer', 'accounting_settings_tab.view')
on conflict (role_code, permission_code) do nothing;

