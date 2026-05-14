-- Stage 10 Phase 1 — ownership spine (claim, pickup, transfer, assignment history, command idempotency).
-- additive only

-- ---------------------------------------------------------------------------
-- work_items: execution claim (≠ assignment)
-- ---------------------------------------------------------------------------
alter table public.work_items
  add column if not exists claimed_by_user_id uuid null references public.users(id) on delete set null,
  add column if not exists claimed_at timestamptz null;

create index if not exists idx_work_items_org_claimed_by
  on public.work_items(org_id, claimed_by_user_id)
  where claimed_by_user_id is not null;

-- ---------------------------------------------------------------------------
-- work_assignment_history — strategic assignment audit trail
-- ---------------------------------------------------------------------------
create table if not exists public.work_assignment_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  work_item_id uuid not null references public.work_items(id) on delete restrict,
  from_assigned_user_id uuid null references public.users(id) on delete set null,
  to_assigned_user_id uuid null references public.users(id) on delete set null,
  actor_user_id uuid null references public.users(id) on delete set null,
  command_type text not null check (char_length(btrim(command_type)) > 0),
  idempotency_key text not null check (char_length(btrim(idempotency_key)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_work_assignment_history_org_item
  on public.work_assignment_history(org_id, work_item_id, created_at desc);

alter table public.work_assignment_history enable row level security;

create policy "work_assignment_history_select_org_member"
  on public.work_assignment_history
  for select
  using (org_id in (select public.organizations_for_current_auth_user()));

-- ---------------------------------------------------------------------------
-- Command idempotency (lease + completion; service role writes)
-- ---------------------------------------------------------------------------
create table if not exists public.work_engine_command_idempotency (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key text not null check (char_length(btrim(idempotency_key)) > 0),
  command_type text not null check (char_length(btrim(command_type)) > 0),
  work_item_id uuid null references public.work_items(id) on delete set null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (org_id, idempotency_key)
);

create index if not exists idx_work_engine_idem_org_completed
  on public.work_engine_command_idempotency(org_id, completed_at);

-- ---------------------------------------------------------------------------
-- Per–work_type policy (org scoped); no row = default allow staff pickup
-- ---------------------------------------------------------------------------
create table if not exists public.work_engine_work_type_policies (
  org_id uuid not null references public.organizations(id) on delete cascade,
  work_type text not null check (char_length(btrim(work_type)) > 0),
  allow_staff_pickup_unassigned boolean not null default true,
  primary key (org_id, work_type)
);

alter table public.work_engine_work_type_policies enable row level security;

create policy "work_engine_work_type_policies_select_org_member"
  on public.work_engine_work_type_policies
  for select
  using (org_id in (select public.organizations_for_current_auth_user()));

-- ---------------------------------------------------------------------------
-- RBAC — pickup + claim (assign remains admin/owner only)
-- ---------------------------------------------------------------------------
insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner',  'work_engine.pickup'),
  ('owner',  'work_engine.claim'),
  ('admin',  'work_engine.pickup'),
  ('admin',  'work_engine.claim'),
  ('staff',  'work_engine.pickup'),
  ('staff',  'work_engine.claim')
on conflict (role_code, permission_code) do nothing;
