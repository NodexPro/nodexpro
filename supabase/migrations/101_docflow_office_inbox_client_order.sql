-- DocFlow office inbox / messenger: order clients by latest thread activity (not display_name only).

create or replace function public.docflow_office_inbox_clients_page(
  p_org_id uuid,
  p_search text,
  p_page int,
  p_page_size int
)
returns table (
  client_id uuid,
  display_name text,
  status text,
  phone text,
  email text,
  last_thread_activity_at timestamptz,
  total_count bigint
)
language sql
stable
as $$
  with scoped as (
    select
      c.id as cid,
      c.display_name as dname,
      c.status as st,
      c.phone as ph,
      c.email as em
    from public.clients c
    where c.organization_id = p_org_id
      and (
        p_search is null
        or trim(p_search) = ''
        or c.display_name ilike '%' || p_search || '%'
        or coalesce(c.phone, '') ilike '%' || p_search || '%'
        or coalesce(c.email, '') ilike '%' || p_search || '%'
      )
  ),
  activity as (
    select t.client_id as aid, max(t.updated_at) as last_at
    from public.client_message_threads t
    where t.org_id = p_org_id
    group by t.client_id
  ),
  joined as (
    select
      s.cid,
      s.dname,
      s.st,
      s.ph,
      s.em,
      a.last_at,
      (select count(*)::bigint from scoped) as cnt
    from scoped s
    left join activity a on a.aid = s.cid
  )
  select
    j.cid,
    j.dname,
    j.st,
    j.ph,
    j.em,
    j.last_at,
    j.cnt
  from joined j
  order by j.last_at desc nulls last, j.dname asc nulls last
  offset greatest(0, (greatest(coalesce(p_page, 1), 1) - 1) * greatest(coalesce(p_page_size, 25), 1))
  limit greatest(1, least(coalesce(p_page_size, 25), 100));
$$;

revoke all on function public.docflow_office_inbox_clients_page(uuid, text, int, int) from public;
grant execute on function public.docflow_office_inbox_clients_page(uuid, text, int, int) to service_role;
