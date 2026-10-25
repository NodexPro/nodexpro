-- Prepared in the original Zentax source on 2026-10-24. Not executed. Not applied to production.
-- Corrected function returns b.request_count. Apply only after 201_mfa_trusted_devices.sql and a separate approval.
-- Staging kabefnmcyhughnyvoxiw already has the corrected function. Do not reapply there. No Redis or paid limiter.
-- The API calls consume_security_rate_bucket with a SHA-256 key, never an email or request body.
-- If this function is absent, login falls back to the process-local limiter and must be reported as degraded.
-- Any other store error makes login fail closed with HTTP 503.

create table if not exists public.security_rate_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  constraint security_rate_buckets_key_len check (char_length(bucket_key) between 8 and 200),
  constraint security_rate_buckets_count_nonnegative check (request_count >= 0)
);

alter table public.security_rate_buckets enable row level security;
alter table public.security_rate_buckets force row level security;
revoke all on table public.security_rate_buckets from public, anon, authenticated;
grant select, insert, update, delete on table public.security_rate_buckets to service_role;

create or replace function public.consume_security_rate_bucket(
  p_key text,
  p_window_seconds integer,
  p_max integer
)
returns table(allowed boolean, request_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_key is null or char_length(p_key) < 8 or char_length(p_key) > 200 then
    raise exception 'invalid rate limit key';
  end if;
  if p_window_seconds < 1 or p_window_seconds > 86400 or p_max < 1 or p_max > 1000 then
    raise exception 'invalid rate limit window';
  end if;

  insert into public.security_rate_buckets as b (bucket_key, window_started_at, request_count)
  values (p_key, now(), 1)
  on conflict (bucket_key) do update
    set window_started_at = case
          when b.window_started_at + make_interval(secs => p_window_seconds) <= now() then now()
          else b.window_started_at
        end,
        request_count = case
          when b.window_started_at + make_interval(secs => p_window_seconds) <= now() then 1
          else b.request_count + 1
        end
  returning b.request_count into v_count;

  allowed := v_count <= p_max;
  request_count := v_count;
  return next;
end;
$$;

revoke all on function public.consume_security_rate_bucket(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_security_rate_bucket(text, integer, integer) to service_role;
