-- Align task center KPI thread counts with list RPC: only threads whose client belongs to the org
-- (same predicate as docflow_task_center_threads_page inner join on clients).
-- Fixes unread_replies_count (and other thread KPIs) exceeding rows visible with default filters.

create or replace function public.docflow_task_center_metrics(
  p_org_id uuid,
  p_user_id uuid
)
returns table (
  overdue_count bigint,
  waiting_client_count bigint,
  needs_review_count bigint,
  pending_drafts_count bigint,
  unread_replies_count bigint,
  assigned_to_me_count bigint
)
language sql
stable
as $$
  select
    (
      select count(*)::bigint
      from public.client_message_threads t
      inner join public.clients c on c.id = t.client_id and c.organization_id = p_org_id
      where t.org_id = p_org_id
        and t.thread_status not in ('archived', 'resolved')
        and t.deadline_at is not null
        and t.deadline_at < now()
    ) as overdue_count,
    (
      select count(*)::bigint
      from public.client_message_threads t
      inner join public.clients c on c.id = t.client_id and c.organization_id = p_org_id
      where t.org_id = p_org_id
        and t.thread_status = 'waiting_client'
    ) as waiting_client_count,
    (
      select count(*)::bigint
      from public.communication_draft_messages d
      where d.org_id = p_org_id
        and d.status = 'draft'
    ) as needs_review_count,
    (
      select count(*)::bigint
      from public.communication_draft_messages d
      where d.org_id = p_org_id
        and d.status in ('draft', 'approved')
    ) as pending_drafts_count,
    (
      select count(*)::bigint
      from public.client_message_threads t
      inner join public.clients c on c.id = t.client_id and c.organization_id = p_org_id
      where t.org_id = p_org_id
        and t.thread_status <> 'archived'
        and exists (
          select 1
          from public.client_messages m
          where m.thread_id = t.id
            and m.org_id = p_org_id
            and m.client_id = t.client_id
            and m.message_status = 'published'
            and m.created_by_type <> 'office'
            and m.created_at > coalesce(
              (
                select max(e.created_at)
                from public.client_message_events e
                where e.thread_id = t.id
                  and e.event_type = 'thread_read_marked_office'
              ),
              '-infinity'::timestamptz
            )
        )
    ) as unread_replies_count,
    (
      select count(*)::bigint
      from public.client_message_threads t
      inner join public.clients c on c.id = t.client_id and c.organization_id = p_org_id
      where t.org_id = p_org_id
        and t.thread_status <> 'archived'
        and t.assigned_user_id is not null
        and t.assigned_user_id = p_user_id
    ) as assigned_to_me_count;
$$;
