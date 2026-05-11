-- DocFlow Office Task Center: metrics + paginated thread list (backend truth for KPIs and table).

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

create or replace function public.docflow_task_center_threads_page(
  p_org_id uuid,
  p_user_id uuid,
  p_search text,
  p_module text,
  p_thread_type text,
  p_thread_status text,
  p_assigned_filter text,
  p_unread_only boolean,
  p_overdue_only boolean,
  p_due_from date,
  p_due_to date,
  p_page int,
  p_page_size int
)
returns table (
  thread_id uuid,
  client_id uuid,
  client_name text,
  module_key text,
  module_name text,
  thread_type text,
  thread_status text,
  deadline_at timestamptz,
  assigned_user_id uuid,
  assigned_display_name text,
  updated_at timestamptz,
  total_count bigint
)
language sql
stable
as $$
  with base as (
    select
      t.id as tid,
      t.client_id as cid,
      coalesce(nullif(trim(c.display_name), ''), 'Client') as cname,
      t.module_key as mkey,
      coalesce(nullif(trim(m.name), ''), t.module_key) as mname,
      t.thread_type as ttype,
      t.thread_status as tstatus,
      t.deadline_at as dlat,
      t.assigned_user_id as auid,
      case
        when t.assigned_user_id is null then null
        else coalesce(nullif(trim(u.full_name), ''), nullif(trim(u.email), ''), 'User')
      end as aname,
      t.updated_at as uat
    from public.client_message_threads t
    join public.clients c on c.id = t.client_id and c.organization_id = p_org_id
    left join public.modules m on m.code = t.module_key
    left join public.users u on u.id = t.assigned_user_id
    where t.org_id = p_org_id
      and (
        (
          (p_thread_status is null or trim(p_thread_status) = '')
          and t.thread_status <> 'archived'
        )
        or (
          p_thread_status is not null
          and trim(p_thread_status) <> ''
          and t.thread_status = p_thread_status
        )
      )
      and (
        p_module is null
        or trim(p_module) = ''
        or t.module_key = p_module
      )
      and (
        p_thread_type is null
        or trim(p_thread_type) = ''
        or t.thread_type = p_thread_type
      )
      and (
        p_search is null
        or trim(p_search) = ''
        or c.display_name ilike '%' || p_search || '%'
        or coalesce(c.phone, '') ilike '%' || p_search || '%'
        or coalesce(c.email, '') ilike '%' || p_search || '%'
      )
      and (
        p_assigned_filter is null
        or trim(p_assigned_filter) = ''
        or trim(lower(p_assigned_filter)) = 'all'
        or (trim(lower(p_assigned_filter)) = 'me' and t.assigned_user_id = p_user_id)
        or (trim(lower(p_assigned_filter)) = 'unassigned' and t.assigned_user_id is null)
        or t.assigned_user_id::text = p_assigned_filter
      )
      and (
        not coalesce(p_overdue_only, false)
        or (
          t.thread_status not in ('archived', 'resolved')
          and t.deadline_at is not null
          and t.deadline_at < now()
        )
      )
      and (
        p_due_from is null
        or t.deadline_at is null
        or (t.deadline_at at time zone 'UTC')::date >= p_due_from
      )
      and (
        p_due_to is null
        or t.deadline_at is null
        or (t.deadline_at at time zone 'UTC')::date <= p_due_to
      )
      and (
        not coalesce(p_unread_only, false)
        or exists (
          select 1
          from public.client_messages m2
          where m2.thread_id = t.id
            and m2.org_id = p_org_id
            and m2.client_id = t.client_id
            and m2.message_status = 'published'
            and m2.created_by_type <> 'office'
            and m2.created_at > coalesce(
              (
                select max(e2.created_at)
                from public.client_message_events e2
                where e2.thread_id = t.id
                  and e2.event_type = 'thread_read_marked_office'
              ),
              '-infinity'::timestamptz
            )
        )
      )
  ),
  counted as (
    select b.*, count(*) over () as cnt
    from base b
  )
  select
    ct.tid,
    ct.cid,
    ct.cname,
    ct.mkey,
    ct.mname,
    ct.ttype,
    ct.tstatus,
    ct.dlat,
    ct.auid,
    ct.aname,
    ct.uat,
    ct.cnt
  from counted ct
  order by ct.uat desc nulls last, ct.cname asc nulls last
  offset greatest(0, (greatest(coalesce(p_page, 1), 1) - 1) * greatest(coalesce(p_page_size, 25), 1))
  limit greatest(1, least(coalesce(p_page_size, 25), 100));
$$;

revoke all on function public.docflow_task_center_metrics(uuid, uuid) from public;
grant execute on function public.docflow_task_center_metrics(uuid, uuid) to service_role;

revoke all on function public.docflow_task_center_threads_page(uuid, uuid, text, text, text, text, text, boolean, boolean, date, date, int, int) from public;
grant execute on function public.docflow_task_center_threads_page(uuid, uuid, text, text, text, text, text, boolean, boolean, date, date, int, int) to service_role;
