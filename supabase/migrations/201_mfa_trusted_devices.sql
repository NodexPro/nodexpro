-- Prepared in the original Zentax source on 2026-10-24. Not executed. Not applied to production.
-- Apply only after a separate approval and only after 200_privileged_mfa_recovery_codes.sql.
-- Staging kabefnmcyhughnyvoxiw already has this table. Do not reapply there.
-- Supabase Auth does not remember a device. A new password login is aal1 until a TOTP code is verified.
-- This table would store only a hash of a credential the API sets in an httpOnly cookie.
-- A localStorage flag or a request field must never be accepted as trust.
-- Trust expires and can be revoked. Password reset, factor removal, and recovery must revoke every row for that user.
-- There is no organization column: the authenticator session is account-level. The API binds the row to the authenticated user id.
-- Do not enable permanent platform-owner MFA lockout only because this file exists. A failure burst can require another MFA step without locking the account.

create table if not exists public.mfa_trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  credential_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  last_seen_at timestamptz null,
  constraint mfa_trusted_devices_hash_len check (char_length(credential_hash) between 20 and 200)
);

create index if not exists mfa_trusted_devices_active_idx
  on public.mfa_trusted_devices (user_id)
  where revoked_at is null;

alter table public.mfa_trusted_devices enable row level security;
alter table public.mfa_trusted_devices force row level security;

revoke all on table public.mfa_trusted_devices from public;
revoke all on table public.mfa_trusted_devices from anon;
revoke all on table public.mfa_trusted_devices from authenticated;
grant select, insert, update, delete on table public.mfa_trusted_devices to service_role;

comment on table public.mfa_trusted_devices is
  'Hashed expiring authenticator device credentials. Applied to staging only on 2026-10-24.';
