-- Owner-side Country Legal Maintainer access (platform-canonical, not tenant RBAC).
-- Tax Brain reserved migration range: 600–699.
-- Does not alter roles, organization_memberships, user_invitations, or assertPlatformOwner.
-- Does not grant authenticated/anon/PUBLIC. API uses service_role only.
-- Does not insert auth.users.

create table if not exists public.owner_country_legal_capability_codes (
  code text primary key,
  label text not null,
  is_activation boolean not null default false
);

insert into public.owner_country_legal_capability_codes (code, label, is_activation) values
  ('legal_knowledge.view', 'View knowledge', false),
  ('legal_knowledge.draft_create', 'Create drafts', false),
  ('legal_knowledge.draft_edit', 'Edit drafts', false),
  ('legal_knowledge.review', 'Review', false),
  ('legal_sources.manage', 'Manage legal sources', false),
  ('legal_values.manage', 'Manage legal values', false),
  ('fact_dictionary.manage', 'Manage client facts', false),
  ('legal_knowledge.activate', 'Activate/Publish', true)
on conflict (code) do nothing;

create table if not exists public.owner_country_legal_access_requests (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null,
  requested_user_id uuid references public.users(id) on delete set null,
  requested_country_codes text[] not null,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  source text not null default 'self_request' check (source in ('self_request', 'owner_invite')),
  decided_by_user_id uuid references public.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_country_legal_access_requests_countries_present check (cardinality(requested_country_codes) >= 1)
);

create unique index if not exists uq_owner_legal_access_request_pending_email
  on public.owner_country_legal_access_requests (email_normalized)
  where status = 'pending';

create index if not exists idx_owner_legal_access_requests_status
  on public.owner_country_legal_access_requests (status, created_at desc);

create table if not exists public.owner_country_legal_assignments (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null,
  user_id uuid references public.users(id) on delete set null,
  country_code text not null references public.countries(code),
  capabilities text[] not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  granted_by_user_id uuid not null references public.users(id),
  granted_at timestamptz not null default now(),
  suspended_at timestamptz,
  suspended_by_user_id uuid references public.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_country_legal_assignments_capabilities_present check (cardinality(capabilities) >= 1)
);

create unique index if not exists uq_owner_legal_assignment_live_email_country
  on public.owner_country_legal_assignments (email_normalized, country_code)
  where status in ('active', 'suspended');

create index if not exists idx_owner_legal_assignments_user
  on public.owner_country_legal_assignments (user_id, status);

create index if not exists idx_owner_legal_assignments_email
  on public.owner_country_legal_assignments (email_normalized, status);

drop trigger if exists trg_owner_country_legal_access_requests_updated on public.owner_country_legal_access_requests;
create trigger trg_owner_country_legal_access_requests_updated
  before update on public.owner_country_legal_access_requests
  for each row execute function public.set_updated_at();

drop trigger if exists trg_owner_country_legal_assignments_updated on public.owner_country_legal_assignments;
create trigger trg_owner_country_legal_assignments_updated
  before update on public.owner_country_legal_assignments
  for each row execute function public.set_updated_at();

alter table public.owner_country_legal_capability_codes enable row level security;
alter table public.owner_country_legal_capability_codes force row level security;
alter table public.owner_country_legal_access_requests enable row level security;
alter table public.owner_country_legal_access_requests force row level security;
alter table public.owner_country_legal_assignments enable row level security;
alter table public.owner_country_legal_assignments force row level security;

revoke all on table public.owner_country_legal_capability_codes from anon, authenticated;
revoke all on table public.owner_country_legal_access_requests from anon, authenticated;
revoke all on table public.owner_country_legal_assignments from anon, authenticated;

grant select on table public.owner_country_legal_capability_codes to service_role;
grant select, insert, update on table public.owner_country_legal_access_requests to service_role;
grant select, insert, update on table public.owner_country_legal_assignments to service_role;
