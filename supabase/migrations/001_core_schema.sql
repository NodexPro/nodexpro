-- Phase 1: Core schema. Application tables in public. No business modules.
-- Supabase/Postgres. All tenant tables have organization_id except users and audit_log (nullable).

-- Extensions (if not already enabled)
create extension if not exists "uuid-ossp";

-- ========== USERS (application identity; not auth.users) ==========
create table public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text not null,
  full_name text,
  status text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  email_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create index idx_users_auth_user_id on public.users(auth_user_id);
create index idx_users_email on public.users(email);

-- ========== ORGANIZATIONS ==========
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  country_code char(2) not null,
  timezone text not null default 'UTC',
  status text not null default 'active' check (status in ('active', 'suspended', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ========== ROLES (system seed) ==========
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  scope text not null default 'organization' check (scope in ('organization', 'global')),
  is_system boolean not null default true,
  created_at timestamptz not null default now()
);

-- ========== PERMISSIONS ==========
create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  domain text not null,
  created_at timestamptz not null default now()
);

create table public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  unique(role_id, permission_id)
);

-- ========== ORGANIZATION_USERS (memberships) ==========
create table public.organization_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role_id uuid not null references public.roles(id),
  membership_status text not null default 'active' check (membership_status in ('active', 'invited', 'suspended', 'removed')),
  joined_at timestamptz not null default now(),
  invited_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, user_id)
);

create index idx_organization_users_org on public.organization_users(organization_id);
create index idx_organization_users_user on public.organization_users(user_id);

-- ========== PLANS ==========
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ========== MODULES (registry) ==========
create table public.modules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  scope_type text not null default 'global' check (scope_type in ('global', 'country')),
  country_code char(2),
  is_active boolean not null default true,
  is_sellable boolean not null default true,
  default_visibility text not null default 'hidden' check (default_visibility in ('visible', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plan_modules (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  unique(plan_id, module_id)
);

-- ========== SUBSCRIPTIONS ==========
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_code text not null,
  status text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'cancelled', 'ended')),
  started_at timestamptz not null default now(),
  ends_at timestamptz,
  trial_ends_at timestamptz,
  cancelled_at timestamptz,
  billing_state text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_subscriptions_org on public.subscriptions(organization_id);

-- ========== ORGANIZATION_MODULES (activation) ==========
create table public.organization_modules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'disabled')),
  activated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  source_subscription_id uuid references public.subscriptions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, module_id)
);

create index idx_organization_modules_org on public.organization_modules(organization_id);

-- ========== AUDIT_LOG (append-only) ==========
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  actor_user_id uuid references public.users(id),
  actor_session_id text,
  module_code text,
  entity_type text not null,
  entity_id text,
  action text not null,
  payload_json jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index idx_audit_log_org_created on public.audit_log(organization_id, created_at desc);
create index idx_audit_log_actor on public.audit_log(actor_user_id, created_at desc);

-- ========== NOTIFICATIONS ==========
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  type text not null,
  title text not null,
  body text,
  status text not null default 'unread' check (status in ('unread', 'read')),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index idx_notifications_org_user on public.notifications(organization_id, user_id);

-- ========== FILE_ASSETS (metadata only; files in Storage) ==========
create table public.file_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  storage_provider text not null default 'supabase',
  storage_key text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  uploaded_by uuid not null references public.users(id),
  access_level text not null default 'organization' check (access_level in ('organization', 'private', 'public')),
  created_at timestamptz not null default now(),
  unique(organization_id, storage_key)
);

create index idx_file_assets_org on public.file_assets(organization_id);

-- ========== UPDATED_AT triggers ==========
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger users_updated_at before update on public.users
  for each row execute function public.set_updated_at();
create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();
create trigger organization_users_updated_at before update on public.organization_users
  for each row execute function public.set_updated_at();
create trigger plans_updated_at before update on public.plans
  for each row execute function public.set_updated_at();
create trigger modules_updated_at before update on public.modules
  for each row execute function public.set_updated_at();
create trigger organization_modules_updated_at before update on public.organization_modules
  for each row execute function public.set_updated_at();
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();
