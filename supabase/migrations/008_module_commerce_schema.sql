-- Module-based commerce. New tables; modules.is_system; deprecated: plans/plan_modules/subscriptions for entitlement.

-- ========== MODULES: is_system ==========
alter table public.modules add column if not exists is_system boolean not null default false;

-- ========== MODULE_PLANS ==========
create table if not exists public.module_plans (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules(id) on delete cascade,
  code text not null,
  name text not null,
  billing_period text not null default 'month' check (billing_period in ('month', 'year')),
  currency char(3) not null,
  price_amount numeric(12,2) not null,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(module_id, code)
);

create index idx_module_plans_module on public.module_plans(module_id);

-- ========== MODULE_PLAN_LIMITS ==========
create table if not exists public.module_plan_limits (
  id uuid primary key default gen_random_uuid(),
  module_plan_id uuid not null references public.module_plans(id) on delete cascade,
  limit_code text not null,
  limit_value numeric(12,2),
  is_unlimited boolean not null default false,
  created_at timestamptz not null default now(),
  unique(module_plan_id, limit_code)
);

create index idx_module_plan_limits_plan on public.module_plan_limits(module_plan_id);

-- ========== ORGANIZATION_MODULE_SUBSCRIPTIONS ==========
create table if not exists public.organization_module_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  module_plan_id uuid not null references public.module_plans(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'cancelled', 'ended', 'pending_payment')),
  started_at timestamptz not null default now(),
  ends_at timestamptz,
  trial_ends_at timestamptz,
  cancelled_at timestamptz,
  billing_state text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, module_id)
);

create index idx_org_module_subs_org on public.organization_module_subscriptions(organization_id);
create index idx_org_module_subs_module on public.organization_module_subscriptions(module_id);

-- ========== ORGANIZATION_MODULES: link to module subscription ==========
alter table public.organization_modules add column if not exists organization_module_subscription_id uuid references public.organization_module_subscriptions(id) on delete set null;

-- ========== UPDATED_AT ==========
create trigger module_plans_updated_at before update on public.module_plans
  for each row execute function public.set_updated_at();
create trigger organization_module_subscriptions_updated_at before update on public.organization_module_subscriptions
  for each row execute function public.set_updated_at();

-- ========== RLS ==========
alter table public.module_plans enable row level security;
alter table public.module_plan_limits enable row level security;
alter table public.organization_module_subscriptions enable row level security;

create policy "module_plans_select_authenticated" on public.module_plans for select to authenticated using (true);
create policy "module_plan_limits_select_authenticated" on public.module_plan_limits for select to authenticated using (true);
create policy "organization_module_subscriptions_select_org_member" on public.organization_module_subscriptions for select
  using (organization_id in (select public.organizations_for_current_auth_user()));

-- ========== LEGACY TABLES DEPRECATION (module entitlement) ==========
-- plans, plan_modules, subscriptions: DEPRECATED for module entitlement.
-- - Kept in DB for backward compatibility only.
-- - Still used only: org creation (optional starter plan); GET /organizations/:id/subscription (legacy).
-- - Module entitlement is resolved ONLY from: modules.is_system and organization_module_subscriptions.
-- - Do not add any logic that derives module entitlement from plans, plan_modules, or subscriptions.
-- See: docs/architecture/commerce-module-based/02-legacy-plans-deprecation.md
