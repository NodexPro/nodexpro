create table if not exists public.owner_email_provider_configs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider_type text not null check (provider_type in ('resend', 'sendgrid', 'smtp')),
  from_email text not null,
  from_name text not null,
  api_key_encrypted text null,
  smtp_host text null,
  smtp_port integer null,
  smtp_user text null,
  smtp_password_encrypted text null,
  is_configured boolean not null default false,
  created_by_user_id uuid null references public.users(id) on delete set null,
  updated_by_user_id uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id)
);

create index if not exists idx_owner_email_provider_configs_org
  on public.owner_email_provider_configs(org_id);

alter table public.owner_email_provider_configs enable row level security;

create policy "owner_email_provider_configs_select_org_member" on public.owner_email_provider_configs
for select using (org_id in (select public.organizations_for_current_auth_user()));

create policy "owner_email_provider_configs_insert_org_member" on public.owner_email_provider_configs
for insert with check (org_id in (select public.organizations_for_current_auth_user()));

create policy "owner_email_provider_configs_update_org_member" on public.owner_email_provider_configs
for update using (org_id in (select public.organizations_for_current_auth_user()));

