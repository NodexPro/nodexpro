-- Durable, service-role-only delivery state for Platform Owner security alerts.
-- This migration is intentionally not applied automatically.

create table if not exists public.security_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  event_action text not null,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  event_kind text not null check (event_kind in ('security', 'test')),
  safe_context jsonb not null default '{}'::jsonb,
  correlation_id text null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'accepted', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0 and attempt_count <= 3),
  max_attempts integer not null default 3 check (max_attempts between 1 and 3),
  next_attempt_at timestamptz not null default now(),
  last_attempted_at timestamptz null,
  accepted_at timestamptz null,
  provider_message_id text null,
  failure_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_security_alert_deliveries_due
  on public.security_alert_deliveries (status, next_attempt_at, created_at);

create index if not exists idx_security_alert_deliveries_recent
  on public.security_alert_deliveries (created_at desc);

create or replace function public.claim_security_alert_deliveries(p_limit integer default 20)
returns setof public.security_alert_deliveries
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select id
    from public.security_alert_deliveries
    where status in ('pending', 'failed')
      and attempt_count < max_attempts
      and next_attempt_at <= now()
    order by next_attempt_at asc, created_at asc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  )
  update public.security_alert_deliveries d
  set status = 'processing',
      attempt_count = d.attempt_count + 1,
      last_attempted_at = now(),
      updated_at = now()
  from due
  where d.id = due.id
  returning d.*;
end;
$$;

create or replace function public.claim_security_alert_delivery_by_id(p_id uuid)
returns setof public.security_alert_deliveries
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select id
    from public.security_alert_deliveries
    where id = p_id
      and status in ('pending', 'failed')
      and attempt_count < max_attempts
      and next_attempt_at <= now()
    for update skip locked
  )
  update public.security_alert_deliveries d
  set status = 'processing',
      attempt_count = d.attempt_count + 1,
      last_attempted_at = now(),
      updated_at = now()
  from due
  where d.id = due.id
  returning d.*;
end;
$$;

alter table public.security_alert_deliveries enable row level security;
alter table public.security_alert_deliveries force row level security;
revoke all on table public.security_alert_deliveries from public, anon, authenticated;
revoke all on function public.claim_security_alert_deliveries(integer) from public, anon, authenticated;
revoke all on function public.claim_security_alert_delivery_by_id(uuid) from public, anon, authenticated;
grant select, insert, update on table public.security_alert_deliveries to service_role;
grant execute on function public.claim_security_alert_deliveries(integer) to service_role;
grant execute on function public.claim_security_alert_delivery_by_id(uuid) to service_role;
