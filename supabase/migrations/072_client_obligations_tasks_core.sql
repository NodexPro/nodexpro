-- Minimal core foundation:
-- 1) simple operational flags on client_operational_profiles
-- 2) core tables: client_obligations, client_tasks

alter table public.client_operational_profiles
  add column if not exists salary_data_received_flag boolean null,
  add column if not exists income_data_received_flag boolean null;

create table if not exists public.client_obligations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  obligation_type text not null,
  period_key text not null,
  due_date date not null,
  status text not null,
  blocking_reason text null,
  related_module text not null,
  is_active boolean not null default true,
  closed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_id, obligation_type, period_key)
);

create index if not exists idx_client_obligations_org_client
  on public.client_obligations (organization_id, client_id);

create index if not exists idx_client_obligations_due
  on public.client_obligations (organization_id, due_date, is_active);

create trigger client_obligations_updated_at
before update on public.client_obligations
for each row execute function public.set_updated_at();

alter table public.client_obligations enable row level security;

create policy "client_obligations_select_org_member" on public.client_obligations
  for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_obligations_insert_org_member" on public.client_obligations
  for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_obligations_update_org_member" on public.client_obligations
  for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_obligations_delete_org_member" on public.client_obligations
  for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create table if not exists public.client_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assignee_user_id uuid null references public.users(id) on delete set null,
  client_id uuid not null references public.clients(id) on delete cascade,
  source_type text not null,
  source_id uuid null,
  task_type text not null,
  title_he text not null,
  description_he text null,
  priority_score int not null default 0,
  priority_level text not null default 'low',
  due_at timestamptz null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz null
);

create index if not exists idx_client_tasks_org_assignee_status
  on public.client_tasks (organization_id, assignee_user_id, status);

create index if not exists idx_client_tasks_org_client
  on public.client_tasks (organization_id, client_id);

create trigger client_tasks_updated_at
before update on public.client_tasks
for each row execute function public.set_updated_at();

alter table public.client_tasks enable row level security;

create policy "client_tasks_select_org_member" on public.client_tasks
  for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_tasks_insert_org_member" on public.client_tasks
  for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_tasks_update_org_member" on public.client_tasks
  for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_tasks_delete_org_member" on public.client_tasks
  for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
