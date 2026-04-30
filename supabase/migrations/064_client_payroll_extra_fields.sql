-- Payroll tab: extra workflow/contact/complexity fields.

alter table public.client_payroll_profiles
  add column if not exists process_data_received_timeliness text null,
  add column if not exists process_payroll_contact_name text null,
  add column if not exists process_payroll_contact_phone text null,
  add column if not exists process_payroll_contact_email text null,
  add column if not exists complexity_special_arrangements text null;
