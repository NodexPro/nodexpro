-- One-time cleanup for legacy auto-derived reported/reported_late states.
-- Scope: payroll_data + income_tax_advance only.
-- Safety: do NOT touch rows with last_reported_at is not null.

begin;

-- Preview counts (can be inspected in migration logs/output)
select
  obligation_type,
  status as legacy_status,
  count(*) as rows_to_fix
from public.client_obligations
where obligation_type in ('payroll_data', 'income_tax_advance')
  and status in ('reported', 'reported_late')
  and last_reported_at is null
  and is_active = true
group by obligation_type, status
order by obligation_type, status;

-- Payroll: if salary data exists -> ready_to_process; else -> missing_data
with payroll_targets as (
  select
    o.id,
    case
      when coalesce(p.salary_data_received_flag, false) then 'ready_to_process'
      else 'missing_data'
    end as next_status,
    case
      when coalesce(p.salary_data_received_flag, false) then null
      else 'חסר חומר מהלקוח'
    end as next_blocking_reason
  from public.client_obligations o
  left join public.client_operational_profiles p
    on p.organization_id = o.organization_id
   and p.client_id = o.client_id
  where o.obligation_type = 'payroll_data'
    and o.status in ('reported', 'reported_late')
    and o.last_reported_at is null
    and o.is_active = true
)
update public.client_obligations o
set
  status = t.next_status,
  blocking_reason = t.next_blocking_reason,
  updated_at = now()
from payroll_targets t
where o.id = t.id;

-- Income advances: if income data exists -> ready_to_report; else -> missing_data
with advance_targets as (
  select
    o.id,
    case
      when coalesce(p.income_data_received_flag, false) then 'ready_to_report'
      else 'missing_data'
    end as next_status,
    case
      when coalesce(p.income_data_received_flag, false) then null
      else 'חסר חומר מהלקוח'
    end as next_blocking_reason
  from public.client_obligations o
  left join public.client_operational_profiles p
    on p.organization_id = o.organization_id
   and p.client_id = o.client_id
  where o.obligation_type = 'income_tax_advance'
    and o.status in ('reported', 'reported_late')
    and o.last_reported_at is null
    and o.is_active = true
)
update public.client_obligations o
set
  status = t.next_status,
  blocking_reason = t.next_blocking_reason,
  updated_at = now()
from advance_targets t
where o.id = t.id;

-- Post-check summary
select
  obligation_type,
  status,
  count(*) as rows_after_fix
from public.client_obligations
where obligation_type in ('payroll_data', 'income_tax_advance')
  and is_active = true
group by obligation_type, status
order by obligation_type, status;

commit;
