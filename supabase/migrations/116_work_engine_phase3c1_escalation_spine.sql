-- Stage 10 Phase 3C-1 — manual escalation spine (additive).
-- work_state = escalated is exclusive; prior state stored for resolve_escalation.

alter table public.work_items
  add column if not exists escalation_reason text null,
  add column if not exists escalation_source text null,
  add column if not exists escalation_prior_work_state text null,
  add column if not exists escalation_acknowledged_at timestamptz null,
  add column if not exists escalation_acknowledged_by_user_id uuid null references public.users(id) on delete set null;

alter table public.work_items drop constraint if exists work_items_escalation_prior_work_state_check;
alter table public.work_items add constraint work_items_escalation_prior_work_state_check check (
  escalation_prior_work_state is null or escalation_prior_work_state in (
    'new','assigned','waiting_human','waiting_client','client_replied',
    'review_pending','approved','rejected','overdue','escalated','done','archived'
  )
);

create index if not exists idx_work_items_org_escalation_owner_active
  on public.work_items(org_id, escalation_owner_id)
  where work_state = 'escalated';

-- RBAC — manual escalation commands (owner/admin = manager in product terms).
insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner', 'work_engine.escalation.escalate'),
  ('owner', 'work_engine.escalation.acknowledge'),
  ('owner', 'work_engine.escalation.resolve'),
  ('owner', 'work_engine.escalation.reassign'),
  ('admin', 'work_engine.escalation.escalate'),
  ('admin', 'work_engine.escalation.acknowledge'),
  ('admin', 'work_engine.escalation.resolve'),
  ('admin', 'work_engine.escalation.reassign')
on conflict (role_code, permission_code) do nothing;
