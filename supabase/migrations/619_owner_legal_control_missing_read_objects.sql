-- Owner Legal Control aggregate — remaining Data API objects + service_role SELECT.
-- Tax Brain reserved migration range: 600–699.
-- DEV hosted projects skipped 097/104/105; PostgREST then returns PGRST205 for:
--   public.platform_settings
--   public.docflow_request_template_definitions
--   public.docflow_request_template_definition_items
--   public.org_module_pricing_adjustments
-- This file is the DEV-safe subset required by GET /api/v1/owner/legal-control.
-- Does not alter client_messages (104 remainder needs DocFlow message schema).
-- Does not alter 097, 104, 105, 616, 617, 618, RLS policies, or default privileges.
-- Does not grant authenticated, anon, or PUBLIC.

create table if not exists public.platform_settings (
  setting_key text primary key,
  setting_value_json jsonb not null default '{}'::jsonb,
  updated_by_user_id uuid null references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.platform_settings enable row level security;

create table if not exists public.docflow_request_template_definitions (
  id uuid primary key default gen_random_uuid(),
  country_code text not null check (char_length(trim(country_code)) >= 2),
  name text not null check (char_length(trim(name)) > 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_docflow_req_tpl_def_country
  on public.docflow_request_template_definitions (country_code)
  where archived_at is null;

create table if not exists public.docflow_request_template_definition_items (
  id uuid primary key default gen_random_uuid(),
  template_definition_id uuid not null references public.docflow_request_template_definitions(id) on delete cascade,
  sort_order int not null default 0,
  label text not null check (char_length(trim(label)) > 0),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_docflow_req_tpl_items_template
  on public.docflow_request_template_definition_items (template_definition_id, sort_order);

drop trigger if exists docflow_request_template_definitions_updated_at on public.docflow_request_template_definitions;
create trigger docflow_request_template_definitions_updated_at
  before update on public.docflow_request_template_definitions
  for each row execute function public.set_updated_at();

drop trigger if exists docflow_request_template_definition_items_updated_at on public.docflow_request_template_definition_items;
create trigger docflow_request_template_definition_items_updated_at
  before update on public.docflow_request_template_definition_items
  for each row execute function public.set_updated_at();

alter table public.docflow_request_template_definitions enable row level security;
alter table public.docflow_request_template_definition_items enable row level security;

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

drop trigger if exists org_module_pricing_adjustments_updated_at on public.org_module_pricing_adjustments;
create trigger org_module_pricing_adjustments_updated_at
  before update on public.org_module_pricing_adjustments
  for each row execute function public.set_updated_at();

alter table public.org_module_pricing_adjustments enable row level security;

grant select on table public.platform_settings to service_role;
grant select on table public.docflow_request_template_definitions to service_role;
grant select on table public.docflow_request_template_definition_items to service_role;
grant select on table public.org_module_pricing_adjustments to service_role;

notify pgrst, 'reload schema';
