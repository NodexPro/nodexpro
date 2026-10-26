-- Security hardening: upload scan status on file_assets.
-- Additive only. Does not alter 204/205 security tables.
-- Re-run safe: IF NOT EXISTS. No DELETE/DROP of existing rows.
-- Do not apply automatically to production.

alter table public.file_assets
  add column if not exists scan_status text not null default 'not_configured';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'file_assets_scan_status_check'
  ) then
    alter table public.file_assets
      add constraint file_assets_scan_status_check
      check (scan_status in ('clean', 'blocked', 'pending', 'quarantined', 'not_configured', 'unavailable'));
  end if;
end
$$;

comment on column public.file_assets.scan_status is
  'Malware scan outcome. not_configured means content guard ran but no scanner claimed the file clean.';

create table if not exists public.security_journal_entries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  action text not null,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  event_type text not null,
  source_ip text null,
  display_ip text not null,
  country text not null default 'Unknown',
  city text not null default 'Unknown',
  attempted_identifier text null,
  attempted_identifier_hash text null,
  attempt_count integer not null default 1 check (attempt_count >= 1),
  detection_reason text not null,
  incident_id uuid null,
  cooldown_status text not null default 'none',
  containment_action text not null default 'none',
  alert_status text not null default 'not_required',
  group_key text not null,
  correlation_id text null,
  hidden_at timestamptz null,
  hidden_by_user_id uuid null
);

create index if not exists idx_security_journal_visible
  on public.security_journal_entries (created_at desc)
  where hidden_at is null;

create index if not exists idx_security_journal_group
  on public.security_journal_entries (group_key, created_at desc);

alter table public.security_journal_entries enable row level security;
alter table public.security_journal_entries force row level security;
revoke all on table public.security_journal_entries from public, anon, authenticated;
grant select, insert, update on table public.security_journal_entries to service_role;
