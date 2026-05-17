-- INC-1b: Income module workspace issuer context (backend-only).

-- Commercial module registration (separate from legacy `invoice` and `client-operations` modules).
insert into public.modules (id, code, name, description, scope_type, is_active, is_sellable, default_visibility, version, category, is_system)
select
  gen_random_uuid(),
  'income',
  'Income / הכנסות',
  'Income documents and issuer workspace',
  'global',
  true,
  true,
  'visible',
  '1.0.0',
  'billing',
  false
where not exists (
  select 1 from public.modules m where m.code = 'income'
);

insert into public.permissions (code, name, domain)
values
  ('income.view', 'View Income module workspace', 'income'),
  ('income.edit', 'Edit Income workspace settings', 'income'),
  ('income.issue', 'Issue Income documents', 'income'),
  ('income.issue_on_behalf', 'Issue Income documents on behalf of clients', 'income')
on conflict (code) do nothing;

insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner', 'income.view'),
  ('owner', 'income.edit'),
  ('owner', 'income.issue'),
  ('owner', 'income.issue_on_behalf'),
  ('admin', 'income.view'),
  ('admin', 'income.edit'),
  ('admin', 'income.issue'),
  ('admin', 'income.issue_on_behalf'),
  ('staff', 'income.view'),
  ('staff', 'income.edit'),
  ('staff', 'income.issue'),
  ('staff', 'income.issue_on_behalf'),
  ('viewer', 'income.view')
on conflict (role_code, permission_code) do nothing;

-- Tenant-owned issuing business profile (self mode issuer_business_id).
create table if not exists public.income_issuer_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  display_name text not null,
  legal_name text null,
  tax_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id)
);

create index if not exists idx_income_issuer_profiles_org
  on public.income_issuer_profiles (organization_id);

drop trigger if exists income_issuer_profiles_updated_at on public.income_issuer_profiles;
create trigger income_issuer_profiles_updated_at
  before update on public.income_issuer_profiles
  for each row execute function public.set_updated_at();

alter table public.income_issuer_profiles enable row level security;

drop policy if exists "income_issuer_profiles_select_org_member" on public.income_issuer_profiles;
create policy "income_issuer_profiles_select_org_member"
  on public.income_issuer_profiles for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

drop policy if exists "income_issuer_profiles_insert_org_member" on public.income_issuer_profiles;
create policy "income_issuer_profiles_insert_org_member"
  on public.income_issuer_profiles for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

drop policy if exists "income_issuer_profiles_update_org_member" on public.income_issuer_profiles;
create policy "income_issuer_profiles_update_org_member"
  on public.income_issuer_profiles for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

-- Per-user persisted issuer workspace selection.
create table if not exists public.income_user_workspace_contexts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  acting_mode text not null check (acting_mode in ('self', 'office_representative')),
  issuer_business_id uuid not null,
  represented_client_id uuid null references public.clients(id) on delete set null,
  context_json jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists idx_income_user_workspace_contexts_org_user
  on public.income_user_workspace_contexts (organization_id, user_id);

drop trigger if exists income_user_workspace_contexts_updated_at on public.income_user_workspace_contexts;
create trigger income_user_workspace_contexts_updated_at
  before update on public.income_user_workspace_contexts
  for each row execute function public.set_updated_at();

alter table public.income_user_workspace_contexts enable row level security;

drop policy if exists "income_user_workspace_contexts_select_org_member" on public.income_user_workspace_contexts;
create policy "income_user_workspace_contexts_select_org_member"
  on public.income_user_workspace_contexts for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

drop policy if exists "income_user_workspace_contexts_insert_org_member" on public.income_user_workspace_contexts;
create policy "income_user_workspace_contexts_insert_org_member"
  on public.income_user_workspace_contexts for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

drop policy if exists "income_user_workspace_contexts_update_org_member" on public.income_user_workspace_contexts;
create policy "income_user_workspace_contexts_update_org_member"
  on public.income_user_workspace_contexts for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

drop policy if exists "income_user_workspace_contexts_delete_org_member" on public.income_user_workspace_contexts;
create policy "income_user_workspace_contexts_delete_org_member"
  on public.income_user_workspace_contexts for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
