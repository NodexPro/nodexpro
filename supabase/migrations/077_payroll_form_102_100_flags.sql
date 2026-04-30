-- Payroll: flags for NI ניכויים auto-sync (טופס 102 / 100 דווח) — command-owned on client_payroll_profiles.

alter table public.client_payroll_profiles
  add column if not exists form_102_reported boolean not null default false,
  add column if not exists form_100_reported boolean not null default false;
