-- Stage 5A — Client Operations ToDo (lightweight sticky-note tasks).
-- Additive. DO NOT RUN until release approval.
-- Domain owner: Client Operations only. Not Work Engine / client_tasks.
-- Archive V1 = completed_at IS NOT NULL. No hard delete. No due_date.

create table if not exists public.client_operations_todos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  assigned_to_user_id uuid not null references public.users(id) on delete restrict,
  task_text text not null,
  -- Semantic priority: 1..4, or NULL = no priority (fifth visual board row).
  priority smallint null check (priority is null or priority between 1 and 4),
  created_at timestamptz not null default now(),
  created_by_user_id uuid null references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid null references public.users(id) on delete set null,
  completed_at timestamptz null,
  completed_by_user_id uuid null references public.users(id) on delete set null,
  constraint client_operations_todos_client_org_fk
    foreign key (client_id, organization_id)
    references public.clients (id, organization_id)
    on delete cascade,
  constraint client_operations_todos_task_text_nonempty
    check (length(btrim(task_text)) > 0),
  constraint client_operations_todos_task_text_maxlen
    check (char_length(task_text) <= 2000),
  constraint client_operations_todos_completed_pair
    check (
      (completed_at is null and completed_by_user_id is null)
      or (completed_at is not null and completed_by_user_id is not null)
    )
);

comment on table public.client_operations_todos is
  'Client Operations ToDo sticky-note tasks. Active = completed_at IS NULL; Archive = completed. No due dates / reminders.';

comment on column public.client_operations_todos.priority is
  'Backend semantic priority 1..4; NULL means no priority (UI fifth row). Not a Work Engine SLA.';

comment on column public.client_operations_todos.assigned_to_user_id is
  'ToDo assignee — independent of client_operational_profiles.assigned_handler_user_id.';

-- Active board: org + assignee + incomplete, ordered by priority/created
create index if not exists idx_co_todos_org_active_assignee
  on public.client_operations_todos (organization_id, assigned_to_user_id, created_at, id)
  where completed_at is null;

create index if not exists idx_co_todos_org_active_priority
  on public.client_operations_todos (organization_id, priority nulls last, created_at, id)
  where completed_at is null;

create index if not exists idx_co_todos_org_active_client
  on public.client_operations_todos (organization_id, client_id)
  where completed_at is null;

-- Archive: org + completed
create index if not exists idx_co_todos_org_archive_completed
  on public.client_operations_todos (organization_id, completed_at desc, id)
  where completed_at is not null;

create index if not exists idx_co_todos_org_archive_assignee
  on public.client_operations_todos (organization_id, assigned_to_user_id, completed_at desc)
  where completed_at is not null;

create index if not exists idx_co_todos_org_archive_client
  on public.client_operations_todos (organization_id, client_id, completed_at desc)
  where completed_at is not null;

create trigger client_operations_todos_updated_at
  before update on public.client_operations_todos
  for each row execute function public.set_updated_at();

alter table public.client_operations_todos enable row level security;
alter table public.client_operations_todos force row level security;

create policy "co_todos_select_org_member"
  on public.client_operations_todos for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_todos_insert_org_member"
  on public.client_operations_todos for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_todos_update_org_member"
  on public.client_operations_todos for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

-- No delete policy for authenticated — V1 has no hard delete; service_role only if ever needed.
revoke all on table public.client_operations_todos from anon;
grant select, insert, update on table public.client_operations_todos to authenticated;
