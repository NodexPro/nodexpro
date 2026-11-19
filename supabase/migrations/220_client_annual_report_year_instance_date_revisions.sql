-- Client Operations: versioned annual-report operational target date history.
-- CREATE TABLE only. Does not UPDATE/DELETE existing instances, submissions, or audit_log.
-- Does NOT backfill from the current instance date (that would rewrite past monthly tabs).
-- DATE_SET already writes audit_log (timestamp + value + operational_period_key).
-- This table is append-only State for the same events so GET does not depend on audit forever.
-- GET remains valid without this table (audit + unchanged instance date).
-- DO NOT APPLY until release approval.

create table if not exists public.client_annual_report_year_instance_date_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  instance_id uuid not null
    references public.client_annual_report_year_instances (id) on delete cascade,
  tax_year integer not null check (tax_year between 1990 and 2200),
  operational_period_key text not null
    check (operational_period_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  operational_target_date date null,
  recorded_at timestamptz not null default now(),
  created_by uuid null references public.users(id) on delete set null,
  constraint client_annual_report_year_instance_date_revisions_client_org_fk
    foreign key (client_id, organization_id)
    references public.clients (id, organization_id)
    on delete cascade
);

comment on table public.client_annual_report_year_instance_date_revisions is
  'Append-only annual operational_target_date revisions keyed by the monthly tab they were saved from. Not statutory; not submitted_on.';

comment on column public.client_annual_report_year_instance_date_revisions.operational_period_key is
  'Effective registry month (YYYY-MM). Later months keep this value until a newer revision.';

comment on column public.client_annual_report_year_instance_date_revisions.operational_target_date is
  'Date that was current for that operational period. Null means the date was cleared.';

create index if not exists idx_co_annual_date_rev_org_instance_recorded
  on public.client_annual_report_year_instance_date_revisions (organization_id, instance_id, recorded_at);

create index if not exists idx_co_annual_date_rev_org_client
  on public.client_annual_report_year_instance_date_revisions (organization_id, client_id);

alter table public.client_annual_report_year_instance_date_revisions enable row level security;

create policy "co_annual_date_rev_select_org_member"
  on public.client_annual_report_year_instance_date_revisions for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "co_annual_date_rev_insert_org_member"
  on public.client_annual_report_year_instance_date_revisions for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

revoke all on public.client_annual_report_year_instance_date_revisions from public;
revoke all on public.client_annual_report_year_instance_date_revisions from anon;
grant select, insert on public.client_annual_report_year_instance_date_revisions to authenticated;
grant select, insert on public.client_annual_report_year_instance_date_revisions to service_role;

create or replace function public.set_client_annual_report_year_instance_date(
  p_organization_id uuid,
  p_client_id uuid,
  p_tax_year integer,
  p_operational_period_key text,
  p_operational_target_date date,
  p_actor_id uuid,
  p_recorded_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_instance_id uuid;
  v_recorded_at timestamptz;
begin
  if p_organization_id is null then
    raise exception 'organization_id required' using errcode = '22023';
  end if;
  if p_client_id is null then
    raise exception 'client_id required' using errcode = '22023';
  end if;
  if p_tax_year is null or p_tax_year < 1990 or p_tax_year > 2200 then
    raise exception 'tax_year invalid' using errcode = '22023';
  end if;
  if p_operational_period_key is null
     or p_operational_period_key !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'operational_period_key must be YYYY-MM' using errcode = '22023';
  end if;

  v_recorded_at := coalesce(p_recorded_at, now());

  select c.id
    into v_client_id
  from public.clients c
  where c.id = p_client_id
    and c.organization_id = p_organization_id
    and c.is_archived = false
  for update;

  if v_client_id is null then
    raise exception 'ANNUAL_DATE_SET_TENANT_MISMATCH' using errcode = 'P0001';
  end if;

  insert into public.client_annual_report_year_instances (
    organization_id,
    client_id,
    tax_year,
    operational_target_date,
    status,
    created_by,
    updated_by,
    updated_at
  ) values (
    p_organization_id,
    p_client_id,
    p_tax_year,
    p_operational_target_date,
    'open',
    p_actor_id,
    p_actor_id,
    v_recorded_at
  )
  on conflict (organization_id, client_id, tax_year)
  do update set
    operational_target_date = excluded.operational_target_date,
    status = case
      when public.client_annual_report_year_instances.status = 'completed' then 'open'
      else public.client_annual_report_year_instances.status
    end,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by
  returning id into v_instance_id;

  insert into public.client_annual_report_year_instance_date_revisions (
    organization_id,
    client_id,
    instance_id,
    tax_year,
    operational_period_key,
    operational_target_date,
    recorded_at,
    created_by
  ) values (
    p_organization_id,
    p_client_id,
    v_instance_id,
    p_tax_year,
    p_operational_period_key,
    p_operational_target_date,
    v_recorded_at,
    p_actor_id
  );

  return v_instance_id;
end;
$$;

comment on function public.set_client_annual_report_year_instance_date(uuid, uuid, integer, text, date, uuid, timestamptz) is
  'Atomically upsert the annual year-instance date and append one date revision. Persistence only; tax year is supplied by API.';

revoke all on function public.set_client_annual_report_year_instance_date(uuid, uuid, integer, text, date, uuid, timestamptz) from public;
revoke all on function public.set_client_annual_report_year_instance_date(uuid, uuid, integer, text, date, uuid, timestamptz) from anon, authenticated;
grant execute on function public.set_client_annual_report_year_instance_date(uuid, uuid, integer, text, date, uuid, timestamptz) to service_role;
