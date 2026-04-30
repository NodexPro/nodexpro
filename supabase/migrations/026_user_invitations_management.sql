-- Invitation management: last_sent_at, send_count, revoked_at

alter table public.user_invitations
  add column if not exists last_sent_at timestamptz,
  add column if not exists send_count int not null default 0,
  add column if not exists revoked_at timestamptz;

-- Backfill existing pending invites: assume sent once at creation
update public.user_invitations
set last_sent_at = created_at, send_count = 1
where status = 'pending' and (last_sent_at is null or send_count = 0);
