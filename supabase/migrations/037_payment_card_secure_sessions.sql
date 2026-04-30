-- SMS verification + 1h secure sessions for copying payment card PAN/expiry; optional card holder names (no CVV in DB).

alter table public.client_tax_settings
  add column if not exists vat_card_holder_name text null,
  add column if not exists income_tax_card_holder_name text null;

comment on column public.client_tax_settings.vat_card_holder_name is 'Display name on VAT credit card; not secret';
comment on column public.client_tax_settings.income_tax_card_holder_name is 'Display name on income-tax credit card; not secret';

create table if not exists public.client_sensitive_access_challenges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  payment_context text not null check (payment_context in ('vat', 'income_tax')),
  code_hash text not null,
  expires_at timestamptz not null,
  attempts_left int not null default 5,
  status text not null default 'pending' check (status in ('pending', 'verified', 'failed', 'expired')),
  created_at timestamptz not null default now()
);

create index if not exists idx_client_sensitive_challenges_org_client
  on public.client_sensitive_access_challenges (organization_id, client_id, created_at desc);

alter table public.client_sensitive_access_challenges enable row level security;

create policy "client_sensitive_challenges_select_org" on public.client_sensitive_access_challenges
  for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_sensitive_challenges_insert_org" on public.client_sensitive_access_challenges
  for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_sensitive_challenges_update_org" on public.client_sensitive_access_challenges
  for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create table if not exists public.client_sensitive_access_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  payment_context text not null check (payment_context in ('vat', 'income_tax')),
  challenge_id uuid references public.client_sensitive_access_challenges(id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, client_id, user_id, payment_context)
);

create index if not exists idx_client_sensitive_sessions_active
  on public.client_sensitive_access_sessions (organization_id, user_id, expires_at desc)
  where is_active = true;

alter table public.client_sensitive_access_sessions enable row level security;

create policy "client_sensitive_sessions_select_org" on public.client_sensitive_access_sessions
  for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_sensitive_sessions_insert_org" on public.client_sensitive_access_sessions
  for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_sensitive_sessions_update_org" on public.client_sensitive_access_sessions
  for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

comment on table public.client_sensitive_access_challenges is 'OTP sent to org phone for payment-card copy unlock; code never stored plaintext';
comment on table public.client_sensitive_access_sessions is '1h window after OTP verify to copy PAN/expiry via API';
