-- Prepared in the original Zentax source on 2026-10-24. Not executed. Not applied to production.
-- Apply only after a separate approval, after 192_postgrest_select_lockdown.sql.
-- Order: 200, then 201, then corrected 202. Do not copy staging migrations 196-199.
-- Staging kabefnmcyhughnyvoxiw already has this table. Do not reapply there.
-- Account-level recovery codes for the authenticator factor. The factor lives on the auth user, not on a tenant.
-- No organization column: a tenant id here would not isolate the auth factor and could be forged from a request body.
-- Browser roles have no privileges. service_role is the only writer, and the API must ignore any caller-supplied user id.
-- Codes are stored as scrypt hashes with a per-code salt. The plaintext exists only in the issue response.
-- Issuing a new set inserts the new rows first, then retires older unused rows. A failed insert does not burn the previous set.
-- Consumption is a conditional update on consumed_at is null.
-- After this table and trusted-device storage both exist, an untrusted platform-owner password session is denied.
-- Do not set PLATFORM_OWNER_EMAIL until that person has a verified factor and recovery codes.
-- Do not set PRIVILEGED_MFA_ENFORCEMENT. Office owner, office admin, and staff stay optional.

create table if not exists public.privileged_mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  code_hash text not null unique,
  code_salt text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  constraint privileged_mfa_recovery_codes_hash_len check (char_length(code_hash) between 20 and 200),
  constraint privileged_mfa_recovery_codes_salt_len check (char_length(code_salt) between 8 and 200)
);

create index if not exists privileged_mfa_recovery_codes_unused_idx
  on public.privileged_mfa_recovery_codes (user_id)
  where consumed_at is null;

alter table public.privileged_mfa_recovery_codes enable row level security;
alter table public.privileged_mfa_recovery_codes force row level security;

revoke all on table public.privileged_mfa_recovery_codes from public;
revoke all on table public.privileged_mfa_recovery_codes from anon;
revoke all on table public.privileged_mfa_recovery_codes from authenticated;
grant select, insert, update, delete on table public.privileged_mfa_recovery_codes to service_role;

comment on table public.privileged_mfa_recovery_codes is
  'Hashed one-time authenticator recovery codes. Applied to staging only on 2026-10-24.';
