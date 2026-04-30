-- Add owner_user_id to organizations. Owner has full control: billing, settings, users, module activation, revoke.

alter table public.organizations
  add column if not exists owner_user_id uuid references public.users(id) on delete set null;

create index if not exists idx_organizations_owner_user_id on public.organizations(owner_user_id);

comment on column public.organizations.owner_user_id is 'User who owns the organization. Only owner can revoke access, manage billing, settings.';
