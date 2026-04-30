-- RBAC: user_invitations for invite flow

create table if not exists public.user_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role_code text not null check (role_code in ('admin', 'staff', 'viewer')),
  invited_by uuid not null references public.users(id),
  token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create index idx_user_invitations_org on public.user_invitations(organization_id);
create index idx_user_invitations_email on public.user_invitations(organization_id, email);
create index idx_user_invitations_token on public.user_invitations(token);
create index idx_user_invitations_status on public.user_invitations(status);
