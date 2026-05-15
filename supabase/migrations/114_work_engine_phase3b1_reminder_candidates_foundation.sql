-- Stage 10 Phase 3B-1 — reminder candidate foundation (schema + category extension).
-- No tenant candidate generation, SLA hooks, or delivery dispatch in this migration.

-- ---------------------------------------------------------------------------
-- country_legal_values: Operational Communication Policies category
-- ---------------------------------------------------------------------------
alter table public.country_legal_values
  drop constraint if exists country_legal_values_category_check;

alter table public.country_legal_values
  add constraint country_legal_values_category_check check (
    category in (
      'VAT',
      'Income Tax',
      'National Insurance',
      'Credit Points',
      'Pricing',
      'Reports',
      'Calendar',
      'Modules',
      'Operational Communication Policies'
    )
  );

-- ---------------------------------------------------------------------------
-- work_reminder_candidates — human-reviewed reminder candidates (not delivery)
-- ---------------------------------------------------------------------------
create table if not exists public.work_reminder_candidates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  work_item_id uuid not null references public.work_items(id) on delete restrict,
  country_code text not null check (char_length(btrim(country_code)) > 0),
  workflow_type text not null check (
    workflow_type in ('waiting_client', 'response_sla', 'review_sla')
  ),
  trigger_type text not null check (char_length(btrim(trigger_type)) > 0),
  step_key text not null check (char_length(btrim(step_key)) > 0),
  policy_version_id uuid not null references public.country_legal_value_versions(id) on delete restrict,
  template_version_id uuid not null references public.country_legal_value_versions(id) on delete restrict,
  status text not null default 'pending_review' check (
    status in ('pending_review', 'edited', 'approved', 'sent', 'cancelled', 'snoozed')
  ),
  channel text not null check (channel in ('docflow', 'email', 'portal')),
  channel_order_snapshot jsonb not null default '[]'::jsonb,
  target_type text not null check (
    target_type in ('client', 'assignee', 'reviewer', 'escalation_owner')
  ),
  target_user_id uuid null,
  client_id uuid null,
  subject text not null,
  generated_subject text not null,
  body text not null,
  generated_body text not null,
  edited_body text null,
  suggested_send_at timestamptz null,
  snoozed_until timestamptz null,
  sla_context_snapshot jsonb not null default '{}'::jsonb,
  created_by_system_rule boolean not null default true,
  created_by_transition_id uuid null references public.work_transitions(id) on delete set null,
  approved_by_user_id uuid null,
  cancelled_by_user_id uuid null,
  approved_at timestamptz null,
  cancelled_at timestamptz null,
  sent_at timestamptz null,
  dedup_key text not null check (char_length(btrim(dedup_key)) > 0),
  idempotency_key text null,
  version integer not null default 1 check (version >= 1),
  work_notification_id uuid null references public.work_notifications(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_reminder_candidates_channel_order_array check (jsonb_typeof(channel_order_snapshot) = 'array')
);

create unique index if not exists ux_work_reminder_candidates_org_dedup
  on public.work_reminder_candidates (org_id, dedup_key);

create index if not exists idx_work_reminder_candidates_org_status_send
  on public.work_reminder_candidates (org_id, status, suggested_send_at);

create index if not exists idx_work_reminder_candidates_org_item_status
  on public.work_reminder_candidates (org_id, work_item_id, status);

create index if not exists idx_work_reminder_candidates_org_workflow_status
  on public.work_reminder_candidates (org_id, workflow_type, status);

create trigger work_reminder_candidates_updated_at
  before update on public.work_reminder_candidates
  for each row execute function public.set_updated_at();

create or replace function public.work_reminder_candidates_assert_org() returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.work_items wi
    where wi.id = new.work_item_id and wi.org_id = new.org_id
  ) then
    raise exception 'work_reminder_candidates.org_id must match work_items.org_id';
  end if;
  return new;
end;
$$;

create trigger work_reminder_candidates_assert_org_trg
  before insert or update of org_id, work_item_id on public.work_reminder_candidates
  for each row execute function public.work_reminder_candidates_assert_org();

alter table public.work_reminder_candidates enable row level security;

create policy "work_reminder_candidates_select_org_member"
  on public.work_reminder_candidates
  for select
  using (org_id in (select public.organizations_for_current_auth_user()));

comment on table public.work_reminder_candidates is
  'Human-reviewed operational reminder candidates. Delivery intents are created only after approval (work_notifications).';

-- ---------------------------------------------------------------------------
-- work_notifications: extend for approved reminder delivery intent (3B-4+)
-- ---------------------------------------------------------------------------
alter table public.work_notifications
  drop constraint if exists work_notifications_intent_type_check;

alter table public.work_notifications
  add constraint work_notifications_intent_type_check check (
    intent_type in (
      'assignment_changed',
      'due_soon',
      'overdue',
      'escalation',
      'client_action_required',
      'client_reply_received',
      'review_required',
      'approval_decision',
      'state_changed',
      'reminder_candidate_approved'
    )
  );

alter table public.work_notifications
  add column if not exists source_reminder_candidate_id uuid null
    references public.work_reminder_candidates(id) on delete set null;

create index if not exists idx_work_notifications_source_reminder_candidate
  on public.work_notifications (source_reminder_candidate_id)
  where source_reminder_candidate_id is not null;
