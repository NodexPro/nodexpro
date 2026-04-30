-- NI ניכויים: explicit "משכורות בטיפול" (payroll in progress), separate from payroll period state.

alter table public.client_ni_deductions_period
  add column if not exists payroll_in_progress boolean not null default false;
