-- Work Engine foundation (Stage 2, additive).
-- Source of truth: docs/work-engine-domain-model.md, docs/work-engine-schema-design.md,
--                  docs/work-engine-state-machine.md,  docs/work-engine-dedup-policy.md,
--                  docs/work-engine-event-contract.md, docs/work-engine-override-precedence.md.
-- This migration only creates new tables, indexes, triggers, RLS policies, and RBAC seeds.
-- It does NOT modify or read from any existing table (DocFlow, client_tasks, client_obligations
-- and other domains remain untouched).
--
-- Deletion policy (audit preservation):
--   * org_id, client_id, work_item_id parent FKs use ON DELETE RESTRICT so that a hard
--     delete of an organization, client, or work item can never auto-erase workflow
--     history. Soft-delete (archived/inactive state) is the supported path.
--   * user FKs use ON DELETE SET NULL — audit rows survive when a user is removed.
--   * file_asset_id uses ON DELETE RESTRICT — files cannot disappear under live links.
--   * work_events.client_id and work_events.work_item_id are nullable SET NULL so
--     standalone audit envelopes can survive parent loss without cascading.

-- ============================================================================
-- 1) work_items: canonical workflow memory
-- ============================================================================

create table if not exists public.work_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  module_key text not null check (char_length(btrim(module_key)) > 0),
  work_type text not null check (char_length(btrim(work_type)) > 0),
  period_key text not null check (char_length(btrim(period_key)) > 0),
  work_state text not null check (work_state in (
    'new','assigned','waiting_human','waiting_client','client_replied',
    'review_pending','approved','rejected','overdue','escalated','done','archived'
  )),
  owner_user_id uuid null references public.users(id) on delete set null,
  assigned_user_id uuid null references public.users(id) on delete set null,
  reviewer_user_id uuid null references public.users(id) on delete set null,
  escalation_owner_id uuid null references public.users(id) on delete set null,
  due_at timestamptz null,
  sla_status text not null default 'none' check (sla_status in (
    'none','on_track','due_soon','overdue','breached'
  )),
  source_module text not null check (char_length(btrim(source_module)) > 0),
  source_entity_type text not null check (char_length(btrim(source_entity_type)) > 0),
  source_entity_id text not null check (char_length(btrim(source_entity_id)) > 0),
  created_by_rule_id uuid null,
  created_by_event_id uuid null,
  created_by_user_id uuid null references public.users(id) on delete set null,
  creation_source_type text not null check (creation_source_type in (
    'event','command','rule','migration'
  )),
  version integer not null default 0 check (version >= 0),
  override_active boolean not null default false,
  override_summary_json jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_work_items_org_client_state
  on public.work_items(org_id, client_id, work_state);

create index if not exists idx_work_items_org_module_state
  on public.work_items(org_id, module_key, work_state);

create index if not exists idx_work_items_org_assigned_active
  on public.work_items(org_id, assigned_user_id, work_state)
  where work_state not in ('done','archived');

create index if not exists idx_work_items_org_reviewer_review
  on public.work_items(org_id, reviewer_user_id, work_state)
  where work_state = 'review_pending';

create index if not exists idx_work_items_org_state_due
  on public.work_items(org_id, work_state, due_at);

create index if not exists idx_work_items_org_client_period
  on public.work_items(org_id, client_id, period_key);

create index if not exists idx_work_items_org_source
  on public.work_items(org_id, source_module, source_entity_id);

create index if not exists idx_work_items_org_updated
  on public.work_items(org_id, updated_at desc);

-- Deduplication invariant from docs/work-engine-dedup-policy.md:
-- at most one ACTIVE work item per (org_id, client_id, module_key, work_type, period_key).
create unique index if not exists ux_work_items_active_dedup
  on public.work_items(org_id, client_id, module_key, work_type, period_key)
  where work_state not in ('done','archived');

create trigger work_items_updated_at
  before update on public.work_items
  for each row execute function public.set_updated_at();

-- Tenant integrity: client_id must belong to the same org as work_items.org_id.
create or replace function public.work_items_assert_client_org() returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.clients c
    where c.id = new.client_id and c.organization_id = new.org_id
  ) then
    raise exception 'work_items.client_id must belong to org_id (cross-tenant write blocked)';
  end if;
  return new;
end;
$$;

create trigger work_items_assert_client_org_trg
  before insert or update of org_id, client_id on public.work_items
  for each row execute function public.work_items_assert_client_org();

-- ============================================================================
-- 2) work_transitions: append-only state-change audit
-- ============================================================================

create table if not exists public.work_transitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  work_item_id uuid not null references public.work_items(id) on delete restrict,
  from_state text null check (
    from_state is null or from_state in (
      'new','assigned','waiting_human','waiting_client','client_replied',
      'review_pending','approved','rejected','overdue','escalated','done','archived'
    )
  ),
  to_state text not null check (to_state in (
    'new','assigned','waiting_human','waiting_client','client_replied',
    'review_pending','approved','rejected','overdue','escalated','done','archived'
  )),
  transition_kind text not null check (transition_kind in (
    'command','automation','override','system_correction'
  )),
  action_code text not null check (char_length(btrim(action_code)) > 0),
  actor_type text not null check (actor_type in ('user','system','rule')),
  actor_user_id uuid null references public.users(id) on delete set null,
  reason_text text null,
  metadata_json jsonb not null default '{}'::jsonb,
  expected_version integer null,
  resulting_version integer not null check (resulting_version >= 0),
  created_at timestamptz not null default now(),
  constraint work_transitions_actor_user_required check (
    actor_type <> 'user' or actor_user_id is not null
  )
);

create index if not exists idx_work_transitions_item_created
  on public.work_transitions(work_item_id, created_at);

create index if not exists idx_work_transitions_org_created
  on public.work_transitions(org_id, created_at desc);

create index if not exists idx_work_transitions_org_kind_created
  on public.work_transitions(org_id, transition_kind, created_at desc);

-- ============================================================================
-- 3) work_checklist_items: sub-steps inside a work item
-- ============================================================================

create table if not exists public.work_checklist_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  work_item_id uuid not null references public.work_items(id) on delete restrict,
  position integer not null default 0,
  key text not null check (char_length(btrim(key)) > 0),
  label_key text not null check (char_length(btrim(label_key)) > 0),
  status text not null default 'pending' check (status in (
    'pending','received','accepted','rejected','n_a'
  )),
  required boolean not null default true,
  linked_file_link_id uuid null,
  linked_source_entity_type text null,
  linked_source_entity_id text null,
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (work_item_id, key)
);

create index if not exists idx_work_checklist_item_position
  on public.work_checklist_items(work_item_id, position);

create index if not exists idx_work_checklist_org_status
  on public.work_checklist_items(org_id, status);

create trigger work_checklist_items_updated_at
  before update on public.work_checklist_items
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 4) work_notifications: delivery intents (not actual sends)
-- ============================================================================

create table if not exists public.work_notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  work_item_id uuid not null references public.work_items(id) on delete restrict,
  audience text not null check (audience in (
    'office_assigned','office_reviewer','office_escalation_owner','office_owner',
    'client_portal','client_external'
  )),
  intent_type text not null check (intent_type in (
    'assignment_changed','due_soon','overdue','escalation','client_action_required',
    'client_reply_received','review_required','approval_decision','state_changed'
  )),
  severity text not null default 'info' check (severity in ('info','warn','urgent')),
  dedup_key text not null check (char_length(btrim(dedup_key)) > 0),
  payload_snapshot jsonb not null default '{}'::jsonb,
  delivery_status text not null default 'pending_dispatch' check (delivery_status in (
    'pending_dispatch','dispatched_to_outbox','cancelled'
  )),
  created_by_transition_id uuid null references public.work_transitions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, work_item_id, dedup_key)
);

create index if not exists idx_work_notifications_outbox_scan
  on public.work_notifications(org_id, delivery_status, created_at);

create index if not exists idx_work_notifications_item_created
  on public.work_notifications(work_item_id, created_at desc);

create index if not exists idx_work_notifications_intent
  on public.work_notifications(org_id, intent_type, severity);

create trigger work_notifications_updated_at
  before update on public.work_notifications
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 5) work_events: append-only inbound + outbound event log
-- ============================================================================

create table if not exists public.work_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  org_id uuid not null references public.organizations(id) on delete restrict,
  direction text not null check (direction in ('inbound','outbound')),
  source_module text not null check (char_length(btrim(source_module)) > 0),
  source_entity_type text not null check (char_length(btrim(source_entity_type)) > 0),
  source_entity_id text not null check (char_length(btrim(source_entity_id)) > 0),
  event_type text not null check (char_length(btrim(event_type)) > 0),
  client_id uuid null references public.clients(id) on delete set null,
  period_key text null,
  work_item_id uuid null references public.work_items(id) on delete set null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  emitted_by_type text not null check (emitted_by_type in ('user','system','rule')),
  emitted_by_id uuid null,
  schema_version integer not null default 1 check (schema_version >= 1),
  idempotency_key text not null check (char_length(btrim(idempotency_key)) > 0),
  payload jsonb not null default '{}'::jsonb,
  processing_status text not null check (processing_status in (
    'accepted','ignored_duplicate','ignored_policy','failed'
  )),
  processing_outcome text not null check (char_length(btrim(processing_outcome)) > 0),
  processing_error text null
);

-- Idempotency: both envelope id AND (source_module, idempotency_key) must be unique per org.
create unique index if not exists ux_work_events_event_id
  on public.work_events(org_id, event_id);

create unique index if not exists ux_work_events_idempotency
  on public.work_events(org_id, source_module, idempotency_key);

create index if not exists idx_work_events_org_module_type
  on public.work_events(org_id, source_module, event_type, received_at desc);

create index if not exists idx_work_events_work_item
  on public.work_events(org_id, work_item_id, received_at desc);

create index if not exists idx_work_events_client_period
  on public.work_events(org_id, client_id, period_key, received_at desc);

create index if not exists idx_work_events_processing
  on public.work_events(org_id, processing_status, received_at desc);

-- Tenant integrity for events that carry a client_id.
create or replace function public.work_events_assert_client_org() returns trigger
language plpgsql
as $$
begin
  if new.client_id is not null and not exists (
    select 1 from public.clients c
    where c.id = new.client_id and c.organization_id = new.org_id
  ) then
    raise exception 'work_events.client_id must belong to org_id (cross-tenant write blocked)';
  end if;
  return new;
end;
$$;

create trigger work_events_assert_client_org_trg
  before insert or update of org_id, client_id on public.work_events
  for each row execute function public.work_events_assert_client_org();

-- ============================================================================
-- 6) work_item_file_links: link a work item to a Core file_assets row
-- ============================================================================

create table if not exists public.work_item_file_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  work_item_id uuid not null references public.work_items(id) on delete restrict,
  checklist_item_id uuid null references public.work_checklist_items(id) on delete set null,
  file_asset_id uuid not null references public.file_assets(id) on delete restrict,
  link_role text not null check (link_role in (
    'evidence','request_attachment','office_attachment','client_upload'
  )),
  created_by_event_id uuid null,
  created_by_user_id uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (work_item_id, file_asset_id, link_role)
);

create index if not exists idx_work_item_file_links_org_item
  on public.work_item_file_links(org_id, work_item_id);

create index if not exists idx_work_item_file_links_file
  on public.work_item_file_links(file_asset_id);

-- Back-fill FK on work_checklist_items.linked_file_link_id (created before this table existed).
alter table public.work_checklist_items
  add constraint work_checklist_items_linked_file_link_fk
  foreign key (linked_file_link_id)
  references public.work_item_file_links(id)
  on delete set null;

-- ============================================================================
-- RLS (read-only via membership; backend writes via service role only)
-- ============================================================================

alter table public.work_items enable row level security;
alter table public.work_transitions enable row level security;
alter table public.work_checklist_items enable row level security;
alter table public.work_notifications enable row level security;
alter table public.work_events enable row level security;
alter table public.work_item_file_links enable row level security;

create policy "work_items_select_org_member" on public.work_items for select
  using (org_id in (select public.organizations_for_current_auth_user()));

create policy "work_transitions_select_org_member" on public.work_transitions for select
  using (org_id in (select public.organizations_for_current_auth_user()));

create policy "work_checklist_items_select_org_member" on public.work_checklist_items for select
  using (org_id in (select public.organizations_for_current_auth_user()));

create policy "work_notifications_select_org_member" on public.work_notifications for select
  using (org_id in (select public.organizations_for_current_auth_user()));

create policy "work_events_select_org_member" on public.work_events for select
  using (org_id in (select public.organizations_for_current_auth_user()));

create policy "work_item_file_links_select_org_member" on public.work_item_file_links for select
  using (org_id in (select public.organizations_for_current_auth_user()));

-- ============================================================================
-- RBAC permission seeds (additive; backend enforcement may be wired later).
-- Permission codes are the conceptual vocabulary from
-- docs/work-engine-boundary.md §11.
-- ============================================================================

-- Role grants (least-privilege per docs/work-engine-boundary.md §11):
--   * owner  : view, write, assign, override, admin
--   * admin  : view, write, assign, override
--   * staff  : view, write          (NO assign — assignment is a managerial action)
--   * viewer : view
insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner',  'work_engine.view'),
  ('owner',  'work_engine.write'),
  ('owner',  'work_engine.assign'),
  ('owner',  'work_engine.override'),
  ('owner',  'work_engine.admin'),
  ('admin',  'work_engine.view'),
  ('admin',  'work_engine.write'),
  ('admin',  'work_engine.assign'),
  ('admin',  'work_engine.override'),
  ('staff',  'work_engine.view'),
  ('staff',  'work_engine.write'),
  ('viewer', 'work_engine.view')
on conflict (role_code, permission_code) do nothing;
