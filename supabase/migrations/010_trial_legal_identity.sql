-- Trial + legal identity. One full-platform trial per legal entity. No raw legal identity in audit/API.

-- ========== ORGANIZATION_LEGAL_IDENTITIES ==========
-- legal_identity_value_normalized: SENSITIVE. Do not include in audit payloads or API responses.
create table if not exists public.organization_legal_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  country_code char(2) not null,
  legal_identity_type text not null,
  legal_identity_value_normalized text not null,
  legal_identity_hash text not null,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id)
);

comment on column public.organization_legal_identities.legal_identity_value_normalized is 'SENSITIVE: normalized value only; do not log or expose to frontend';
comment on column public.organization_legal_identities.legal_identity_hash is 'One-way hash for anti-abuse; one trial per hash';

create index idx_org_legal_identities_org on public.organization_legal_identities(organization_id);
create index idx_org_legal_identities_hash on public.organization_legal_identities(legal_identity_hash);

-- ========== ORGANIZATION_TRIALS ==========
create table if not exists public.organization_trials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  legal_identity_hash text not null,
  trial_scope text not null default 'full_platform' check (trial_scope in ('full_platform')),
  status text not null default 'not_started' check (status in ('not_started', 'trialing', 'trial_expired', 'converted', 'blocked')),
  started_at timestamptz,
  ends_at timestamptz,
  converted_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, trial_scope)
);

create index idx_org_trials_org on public.organization_trials(organization_id);
create index idx_org_trials_hash on public.organization_trials(legal_identity_hash);

-- ========== UPDATED_AT (function exists in 001) ==========
create trigger organization_legal_identities_updated_at before update on public.organization_legal_identities
  for each row execute function public.set_updated_at();
create trigger organization_trials_updated_at before update on public.organization_trials
  for each row execute function public.set_updated_at();

-- ========== RLS ==========
alter table public.organization_legal_identities enable row level security;
alter table public.organization_trials enable row level security;

create policy "organization_legal_identities_org_member" on public.organization_legal_identities
  for all using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "organization_trials_org_member" on public.organization_trials
  for all using (organization_id in (select public.organizations_for_current_auth_user()));
