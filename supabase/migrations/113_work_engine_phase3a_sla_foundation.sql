-- Stage 10 Phase 3A — operational SLA foundation (obligations + policy defaults).
-- No reminders, escalation, scheduler, or legal deadlines.

-- ---------------------------------------------------------------------------
-- work_engine_work_type_policies: operational SLA defaults (minutes)
-- ---------------------------------------------------------------------------
alter table public.work_engine_work_type_policies
  add column if not exists response_sla_minutes integer not null default 240,
  add column if not exists review_sla_minutes integer not null default 2880,
  add column if not exists waiting_client_timeout_minutes integer not null default 10080,
  add column if not exists due_soon_threshold_minutes integer not null default 60;

do $$
begin
  alter table public.work_engine_work_type_policies
    add constraint work_engine_work_type_policies_response_sla_minutes_check
      check (response_sla_minutes > 0);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.work_engine_work_type_policies
    add constraint work_engine_work_type_policies_review_sla_minutes_check
      check (review_sla_minutes > 0);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.work_engine_work_type_policies
    add constraint work_engine_work_type_policies_waiting_client_timeout_minutes_check
      check (waiting_client_timeout_minutes > 0);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.work_engine_work_type_policies
    add constraint work_engine_work_type_policies_due_soon_threshold_minutes_check
      check (due_soon_threshold_minutes > 0);
exception when duplicate_object then null;
end $$;

comment on column public.work_engine_work_type_policies.response_sla_minutes is
  'Operational office response SLA (minutes); not a legal/regulatory deadline.';
comment on column public.work_engine_work_type_policies.review_sla_minutes is
  'Operational reviewer SLA while work_state=review_pending (minutes).';
comment on column public.work_engine_work_type_policies.waiting_client_timeout_minutes is
  'Operational client-wait timeout while work_state=waiting_client (minutes).';
comment on column public.work_engine_work_type_policies.due_soon_threshold_minutes is
  'Minutes before due_at when sla_status becomes due_soon.';

-- ---------------------------------------------------------------------------
-- work_sla_obligations: per work_item operational SLA clocks
-- ---------------------------------------------------------------------------
create table if not exists public.work_sla_obligations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  work_item_id uuid not null references public.work_items(id) on delete restrict,
  kind text not null check (kind in ('response', 'waiting_client', 'review')),
  policy_version_id uuid null,
  starts_at timestamptz not null,
  due_at timestamptz not null,
  paused_at timestamptz null,
  pause_reason text null,
  status text not null check (status in ('active', 'met', 'breached', 'cancelled')),
  breached_at timestamptz null,
  source_transition_id uuid null references public.work_transitions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_sla_obligations_pause_pair check (
    paused_at is null or char_length(btrim(coalesce(pause_reason, ''))) > 0
  ),
  constraint work_sla_obligations_breached_pair check (
    status <> 'breached' or breached_at is not null
  )
);

create unique index if not exists ux_work_sla_obligations_one_active
  on public.work_sla_obligations (work_item_id, kind)
  where status = 'active';

create index if not exists idx_work_sla_obligations_org_item
  on public.work_sla_obligations (org_id, work_item_id);

create index if not exists idx_work_sla_obligations_org_status_due
  on public.work_sla_obligations (org_id, status, due_at)
  where status = 'active';

create trigger work_sla_obligations_updated_at
  before update on public.work_sla_obligations
  for each row execute function public.set_updated_at();

create or replace function public.work_sla_obligations_assert_org() returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.work_items wi
    where wi.id = new.work_item_id and wi.org_id = new.org_id
  ) then
    raise exception 'work_sla_obligations.org_id must match work_items.org_id';
  end if;
  return new;
end;
$$;

create trigger work_sla_obligations_assert_org_trg
  before insert or update of org_id, work_item_id on public.work_sla_obligations
  for each row execute function public.work_sla_obligations_assert_org();

alter table public.work_sla_obligations enable row level security;

create policy "work_sla_obligations_select_org_member"
  on public.work_sla_obligations
  for select
  using (org_id in (select public.organizations_for_current_auth_user()));
