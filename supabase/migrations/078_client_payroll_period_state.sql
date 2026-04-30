-- Payroll process (שכר column) — period-scoped truth; same payroll_period_key as ניכויים (previous calendar month, Asia/Jerusalem).
-- Spec: not_relevant clears all flags; sent_to_employer requires salary_data_received; no_salaries forces others false.
-- Single source for משכורות נשלחו — salary_sent removed from client_ni_deductions_period.

create table if not exists public.client_payroll_period_state (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  payroll_period_key text not null,
  salary_data_received boolean not null default false,
  sent_to_employer boolean not null default false,
  no_salaries_this_month boolean not null default false,
  not_relevant boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id, payroll_period_key)
);

create index if not exists idx_client_payroll_period_state_org_client
  on public.client_payroll_period_state (organization_id, client_id);

create trigger client_payroll_period_state_updated_at
before update on public.client_payroll_period_state
for each row execute function public.set_updated_at();

alter table public.client_payroll_period_state enable row level security;

create policy "client_payroll_period_state_select_org_member" on public.client_payroll_period_state
  for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_payroll_period_state_insert_org_member" on public.client_payroll_period_state
  for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_payroll_period_state_update_org_member" on public.client_payroll_period_state
  for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_payroll_period_state_delete_org_member" on public.client_payroll_period_state
  for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

-- Migrate משכורות נשלחו from legacy column into payroll period state (best-effort).
insert into public.client_payroll_period_state (
  organization_id,
  client_id,
  payroll_period_key,
  salary_data_received,
  sent_to_employer,
  no_salaries_this_month,
  not_relevant
)
select
  organization_id,
  client_id,
  period_key,
  false,
  salary_sent,
  false,
  false
from public.client_ni_deductions_period
where salary_sent = true
on conflict (organization_id, client_id, payroll_period_key) do update set
  sent_to_employer = excluded.sent_to_employer,
  updated_at = now();

alter table public.client_ni_deductions_period
  drop column if exists salary_sent;
