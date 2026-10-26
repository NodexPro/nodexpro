-- Security Phase 5: durable detection buckets, incidents and reversible containment.
-- Additive only. Does not alter security_alert_deliveries or other 204 objects.
-- Re-run safe: IF NOT EXISTS / CREATE OR REPLACE. No DELETE/DROP of existing rows.
-- Do not apply automatically to production.

create table if not exists public.security_detection_buckets (
  bucket_key text primary key,
  request_count integer not null default 0 check (request_count >= 0),
  window_started_at timestamptz not null default now(),
  window_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.security_incidents (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  event_type text not null,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  confidence text not null check (confidence in ('confirmed', 'suspicious', 'benign')),
  status text not null default 'active' check (status in ('active', 'released', 'expired', 'closed')),
  rule_id text not null,
  evidence_summary text not null,
  evidence_json jsonb not null default '{}'::jsonb,
  source_ip text null,
  actor_user_id uuid null,
  organization_id uuid null,
  session_fingerprint text null,
  correlation_id text null,
  containment_action text not null check (
    containment_action in ('none', 'temporary_source_block', 'restrict_user_sensitive_commands', 'owner_review')
  ),
  containment_status text not null default 'none' check (
    containment_status in ('none', 'active', 'owner_review', 'released', 'expired')
  ),
  released_at timestamptz null,
  released_by_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.security_containment_rules (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.security_incidents(id) on delete cascade,
  scope text not null check (scope in ('source_ip', 'user', 'session')),
  subject_hash text not null,
  action text not null check (action in ('temporary_source_block', 'restrict_user_sensitive_commands')),
  status text not null default 'active' check (status in ('active', 'released', 'expired')),
  reason text not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz null,
  released_by_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint security_containment_expires_after_start check (expires_at > starts_at)
);

create unique index if not exists ux_security_containment_active_subject
  on public.security_containment_rules (scope, subject_hash, action)
  where status = 'active';

create index if not exists idx_security_containment_lookup
  on public.security_containment_rules (scope, subject_hash, status, expires_at desc);

create index if not exists idx_security_incidents_recent
  on public.security_incidents (created_at desc);

create index if not exists idx_security_incidents_status
  on public.security_incidents (status, severity, created_at desc);

create or replace function public.record_security_detection_bucket(
  p_bucket_key text,
  p_window_seconds integer
)
returns table(request_count integer, window_expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_window_seconds integer := greatest(1, least(coalesce(p_window_seconds, 600), 86400));
begin
  if p_bucket_key is null or char_length(p_bucket_key) < 8 or char_length(p_bucket_key) > 200 then
    raise exception 'invalid detection bucket key';
  end if;

  insert into public.security_detection_buckets as b (
    bucket_key,
    request_count,
    window_started_at,
    window_expires_at,
    updated_at
  )
  values (
    p_bucket_key,
    1,
    v_now,
    v_now + make_interval(secs => v_window_seconds),
    v_now
  )
  on conflict (bucket_key) do update
    set request_count = case
        when b.window_expires_at <= v_now then 1
        else b.request_count + 1
      end,
      window_started_at = case
        when b.window_expires_at <= v_now then v_now
        else b.window_started_at
      end,
      window_expires_at = case
        when b.window_expires_at <= v_now then v_now + make_interval(secs => v_window_seconds)
        else b.window_expires_at
      end,
      updated_at = v_now
  returning b.request_count, b.window_expires_at
  into request_count, window_expires_at;

  return next;
end;
$$;

alter table public.security_detection_buckets enable row level security;
alter table public.security_detection_buckets force row level security;
alter table public.security_incidents enable row level security;
alter table public.security_incidents force row level security;
alter table public.security_containment_rules enable row level security;
alter table public.security_containment_rules force row level security;

revoke all on table public.security_detection_buckets from public, anon, authenticated;
revoke all on table public.security_incidents from public, anon, authenticated;
revoke all on table public.security_containment_rules from public, anon, authenticated;
revoke all on function public.record_security_detection_bucket(text, integer) from public, anon, authenticated;

grant select, insert, update, delete on table public.security_detection_buckets to service_role;
grant select, insert, update on table public.security_incidents to service_role;
grant select, insert, update on table public.security_containment_rules to service_role;
grant execute on function public.record_security_detection_bucket(text, integer) to service_role;

