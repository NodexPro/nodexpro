-- Owner Commercial Controls (MVP): temporary pricing adjustments per org+module.

create table if not exists public.org_module_pricing_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  adjustment_type text not null check (adjustment_type in ('discount_amount', 'replace_price', 'add_amount', 'free_access')),
  value_amount numeric(12,2),
  effective_from date not null,
  effective_until date not null,
  reason text not null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  cancelled_at timestamptz,
  created_by_owner_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_org_module_pricing_adj_scope
  on public.org_module_pricing_adjustments (organization_id, module_id, effective_from, effective_until)
  where status = 'active';

create trigger org_module_pricing_adjustments_updated_at
  before update on public.org_module_pricing_adjustments
  for each row execute function public.set_updated_at();

alter table public.org_module_pricing_adjustments enable row level security;

-- Owner-only backend writes; no frontend direct access.
