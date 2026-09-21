-- Client Operations — period-scoped מקדמות מס הכנסה material (מה״כ).
-- Extends existing client_operations_period_material_facts; no VAT/payroll schema changes.
-- Does NOT backfill history from profile income_data_received_flag.

alter table public.client_operations_period_material_facts
  add column if not exists income_tax_advance_material_brought boolean not null default false;

comment on column public.client_operations_period_material_facts.income_tax_advance_material_brought is
  'Material received for מקדמות מס הכנסה (מה״כ) for this operational period. Does NOT represent מס הכנסה ניכויים.';
