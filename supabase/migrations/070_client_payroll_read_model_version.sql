-- Payroll tab: optimistic concurrency (read model version), aligned with annual/fees/documents.

alter table public.client_payroll_profiles
  add column if not exists read_model_version int not null default 1;
