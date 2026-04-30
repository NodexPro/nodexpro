-- Phase 2: Module framework. Extend modules, add dependencies, settings, activation states.

-- ========== MODULES: new columns ==========
alter table public.modules
  add column if not exists version text not null default '1.0.0',
  add column if not exists category text,
  add column if not exists schema_version text default '1',
  add column if not exists migration_version text default '0',
  add column if not exists nav_label text,
  add column if not exists nav_path text,
  add column if not exists nav_order int default 0;

-- scope_type: allow 'system'
alter table public.modules drop constraint if exists modules_scope_type_check;
alter table public.modules add constraint modules_scope_type_check
  check (scope_type in ('global', 'country', 'system'));

-- ========== MODULE_DEPENDENCIES ==========
create table if not exists public.module_dependencies (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules(id) on delete cascade,
  depends_on_module_id uuid not null references public.modules(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(module_id, depends_on_module_id),
  check (module_id != depends_on_module_id)
);

create index idx_module_dependencies_module on public.module_dependencies(module_id);
create index idx_module_dependencies_depends_on on public.module_dependencies(depends_on_module_id);

-- ========== ORGANIZATION_MODULES: extend status ==========
update public.organization_modules set status = 'deactivated' where status = 'disabled';
alter table public.organization_modules drop constraint if exists organization_modules_status_check;
alter table public.organization_modules add constraint organization_modules_status_check
  check (status in ('inactive', 'activating', 'active', 'suspended', 'deactivated'));

-- ========== MODULE_SETTINGS (global per module) ==========
create table if not exists public.module_settings (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules(id) on delete cascade,
  key text not null,
  value_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(module_id, key)
);

create index idx_module_settings_module on public.module_settings(module_id);

-- ========== ORGANIZATION_MODULE_SETTINGS (per org per module) ==========
create table if not exists public.organization_module_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete cascade,
  key text not null,
  value_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, module_id, key)
);

create index idx_org_module_settings_org_module on public.organization_module_settings(organization_id, module_id);

-- ========== UPDATED_AT for new tables ==========
create trigger module_settings_updated_at before update on public.module_settings
  for each row execute function public.set_updated_at();
create trigger organization_module_settings_updated_at before update on public.organization_module_settings
  for each row execute function public.set_updated_at();

-- ========== RLS ==========
alter table public.module_dependencies enable row level security;
alter table public.module_settings enable row level security;
alter table public.organization_module_settings enable row level security;

create policy "module_dependencies_select_authenticated" on public.module_dependencies for select to authenticated using (true);
create policy "module_settings_select_authenticated" on public.module_settings for select to authenticated using (true);
create policy "organization_module_settings_select_org_member" on public.organization_module_settings for select
  using (organization_id in (select public.organizations_for_current_auth_user()));

-- ========== Phase 2: modules:write permission ==========
insert into public.permissions (id, code, name, domain) values
  ('b0000000-0000-4000-8000-000000000011', 'modules:write', 'Activate/deactivate modules', 'core')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p where r.code = 'admin' and p.code = 'modules:write'
on conflict (role_id, permission_id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p where r.code = 'member' and p.code = 'modules:write'
on conflict (role_id, permission_id) do nothing;
