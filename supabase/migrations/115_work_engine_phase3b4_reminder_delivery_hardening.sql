-- Stage 10 Phase 3B-4 — reminder delivery hardening + dedup lifecycle support.

alter table public.work_reminder_candidates
  drop constraint if exists work_reminder_candidates_status_check;

alter table public.work_reminder_candidates
  add constraint work_reminder_candidates_status_check check (
    status in (
      'pending_review',
      'edited',
      'approved',
      'sending',
      'sent',
      'cancelled',
      'snoozed',
      'delivery_failed'
    )
  );

alter table public.work_reminder_candidates
  add column if not exists delivery_status text not null default 'not_started' check (
    delivery_status in ('not_started', 'pending_dispatch', 'dispatched', 'delivered', 'failed')
  );

alter table public.work_reminder_candidates
  add column if not exists delivery_error text null;

create unique index if not exists ux_work_notifications_org_source_reminder_candidate
  on public.work_notifications (org_id, source_reminder_candidate_id)
  where source_reminder_candidate_id is not null;

comment on column public.work_reminder_candidates.delivery_status is
  'Delivery pipeline state separate from human review status (status).';
