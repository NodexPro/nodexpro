-- TAX-627 — Knowledge Trainer structure analysis runs (staging durability).
-- Tax Brain reserved migration range: 600–699.
-- DEV-only apply: Supabase project jgxezhjctrgfbmmkqqhn / branch develop.
-- Do not apply to production.
--
-- ADDITIVE ONLY. Does not alter ownership or columns of:
--   tax_domains, tax_sources, tax_legal_nodes, tax_rules, tax_rule_versions,
--   country_legal_values, country_legal_value_versions, tax_fact_definitions.
-- Does not drop, rewrite, or edit migrations 620–626.
-- Does not insert, accept, or activate canonical law.
--
-- Purpose: a rebuild must never destroy a complete review set before the
-- replacement set is fully persisted and atomically switched.

create table if not exists public.legal_ingestion_structure_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.legal_ingestion_jobs(id) on delete restrict,
  document_id uuid not null references public.legal_ingestion_documents(id) on delete restrict,
  country_code char(2) not null references public.countries(code) on delete restrict,
  tax_source_id uuid not null,
  status text not null check (status in ('building', 'ready', 'failed', 'superseded', 'cancelled')),
  detector_version text not null,
  layout_used boolean not null default false,
  expected_candidate_count integer not null default 0 check (expected_candidate_count >= 0),
  persisted_candidate_count integer not null default 0 check (persisted_candidate_count >= 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  failure_reason text null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(detector_version) <> ''),
  foreign key (tax_source_id, country_code)
    references public.tax_sources (id, country_code)
    on delete restrict
);

comment on table public.legal_ingestion_structure_runs is
  'TAX-627 Trainer staging analysis run. Owner review reads only the job active READY run. Worker/detector never writes tax_legal_nodes.';

comment on column public.legal_ingestion_structure_runs.status is
  'building = invisible insert; ready = may be active; failed/cancelled = invisible; superseded = previous complete run kept for audit.';

create unique index if not exists uq_legal_ingestion_structure_runs_one_building
  on public.legal_ingestion_structure_runs (job_id)
  where status = 'building';

create unique index if not exists uq_legal_ingestion_structure_runs_one_ready
  on public.legal_ingestion_structure_runs (job_id)
  where status = 'ready';

create index if not exists idx_legal_ingestion_structure_runs_job
  on public.legal_ingestion_structure_runs (job_id, started_at desc);

alter table public.legal_ingestion_jobs
  add column if not exists active_structure_run_id uuid null;

alter table public.legal_ingestion_candidates
  add column if not exists structure_run_id uuid null references public.legal_ingestion_structure_runs(id) on delete restrict;

create index if not exists idx_legal_ingestion_candidates_structure_run
  on public.legal_ingestion_candidates (structure_run_id, sort_order, created_at);

comment on column public.legal_ingestion_jobs.active_structure_run_id is
  'TAX-627 pointer to the active READY structure run. Owner aggregate reads only this run.';

comment on column public.legal_ingestion_candidates.structure_run_id is
  'TAX-627 analysis run that owns this staging row. Nullable only for pre-backfill rows.';

-- Circular job ↔ run pointer. Added after both tables exist.
alter table public.legal_ingestion_jobs
  drop constraint if exists legal_ingestion_jobs_active_structure_run_id_fkey;
alter table public.legal_ingestion_jobs
  add constraint legal_ingestion_jobs_active_structure_run_id_fkey
  foreign key (active_structure_run_id)
  references public.legal_ingestion_structure_runs(id)
  on delete restrict;

drop trigger if exists legal_ingestion_structure_runs_updated_at on public.legal_ingestion_structure_runs;
create trigger legal_ingestion_structure_runs_updated_at
  before update on public.legal_ingestion_structure_runs
  for each row execute function public.set_updated_at();

create or replace function public.legal_ingestion_jobs_active_run_guard()
returns trigger
language plpgsql
as $$
declare
  v_status text;
  v_job_id uuid;
begin
  if new.active_structure_run_id is null then
    return new;
  end if;
  select r.status, r.job_id
    into v_status, v_job_id
  from public.legal_ingestion_structure_runs r
  where r.id = new.active_structure_run_id;
  if v_status is null then
    raise exception 'active_structure_run_id must reference an existing structure run';
  end if;
  if v_job_id is distinct from new.id then
    raise exception 'active_structure_run_id must belong to the same job';
  end if;
  if v_status is distinct from 'ready' then
    raise exception 'active_structure_run_id must reference a READY structure run';
  end if;
  return new;
end;
$$;

drop trigger if exists legal_ingestion_jobs_active_run_guard on public.legal_ingestion_jobs;
create trigger legal_ingestion_jobs_active_run_guard
  before insert or update of active_structure_run_id
  on public.legal_ingestion_jobs
  for each row execute function public.legal_ingestion_jobs_active_run_guard();

create or replace function public.legal_ingestion_fail_structure_run(
  p_run_id uuid,
  p_failure_reason text
)
returns public.legal_ingestion_structure_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.legal_ingestion_structure_runs;
begin
  if p_run_id is null then
    raise exception 'structure run id is required';
  end if;

  update public.legal_ingestion_structure_runs r
  set
    status = 'failed',
    failure_reason = nullif(btrim(coalesce(p_failure_reason, '')), ''),
    completed_at = now(),
    updated_at = now()
  where r.id = p_run_id
    and r.status = 'building'
  returning * into v_run;

  if v_run.id is null then
    select * into v_run
    from public.legal_ingestion_structure_runs
    where id = p_run_id;
    if v_run.id is null then
      raise exception 'Structure run not found';
    end if;
    if v_run.status is distinct from 'failed' then
      raise exception 'Only a BUILDING structure run can be marked failed';
    end if;
  end if;

  return v_run;
end;
$$;

comment on function public.legal_ingestion_fail_structure_run(uuid, text) is
  'TAX-627 mark a BUILDING run failed. Does not change job.active_structure_run_id or delete candidates.';

create or replace function public.legal_ingestion_activate_structure_run(
  p_job_id uuid,
  p_run_id uuid,
  p_expected_count integer,
  p_warning_count integer,
  p_job_status text,
  p_last_error text
)
returns public.legal_ingestion_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.legal_ingestion_jobs;
  v_run public.legal_ingestion_structure_runs;
  v_persisted integer;
  v_orphan integer;
  v_self_parent integer;
  v_prev uuid;
begin
  if p_job_id is null or p_run_id is null then
    raise exception 'job id and structure run id are required';
  end if;
  if p_expected_count is null or p_expected_count < 0 then
    raise exception 'expected_count must be >= 0';
  end if;
  if p_job_status is null or btrim(p_job_status) = '' then
    raise exception 'job status is required';
  end if;

  perform 1
  from public.legal_ingestion_jobs j
  where j.id = p_job_id
  for update;

  perform 1
  from public.legal_ingestion_structure_runs r
  where r.id = p_run_id
  for update;

  select * into v_job
  from public.legal_ingestion_jobs
  where id = p_job_id;
  if not found then
    raise exception 'Legal ingestion job not found';
  end if;

  select * into v_run
  from public.legal_ingestion_structure_runs
  where id = p_run_id;
  if not found then
    raise exception 'Structure run not found';
  end if;

  if v_run.job_id is distinct from p_job_id then
    raise exception 'Structure run does not belong to this job';
  end if;
  if v_run.status is distinct from 'building' then
    raise exception 'Only a BUILDING structure run can be activated';
  end if;
  if v_run.expected_candidate_count is distinct from p_expected_count then
    raise exception 'Structure run expected_candidate_count does not match cutover payload';
  end if;

  select count(*)::integer into v_persisted
  from public.legal_ingestion_candidates c
  where c.structure_run_id = p_run_id;

  if v_persisted is distinct from p_expected_count then
    raise exception 'Persisted candidate count % does not match expected %', v_persisted, p_expected_count;
  end if;
  if v_run.persisted_candidate_count is distinct from p_expected_count then
    raise exception 'Run persisted_candidate_count does not match expected count';
  end if;

  select count(*)::integer into v_self_parent
  from public.legal_ingestion_candidates c
  where c.structure_run_id = p_run_id
    and c.parent_candidate_id is not null
    and c.parent_candidate_id = c.id;
  if v_self_parent > 0 then
    raise exception 'Structure run has self-parent candidate links';
  end if;

  select count(*)::integer into v_orphan
  from public.legal_ingestion_candidates c
  where c.structure_run_id = p_run_id
    and c.parent_candidate_id is not null
    and not exists (
      select 1
      from public.legal_ingestion_candidates p
      where p.id = c.parent_candidate_id
        and p.structure_run_id = p_run_id
    );
  if v_orphan > 0 then
    raise exception 'Structure run has orphan or cross-run parent links';
  end if;

  v_prev := v_job.active_structure_run_id;

  if v_prev is not null and v_prev is distinct from p_run_id then
    update public.legal_ingestion_structure_runs
    set
      status = 'superseded',
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
    where id = v_prev
      and status = 'ready';
    if not found then
      raise exception 'Previous active structure run is not READY and cannot be superseded';
    end if;
  end if;

  update public.legal_ingestion_structure_runs
  set
    status = 'ready',
    persisted_candidate_count = v_persisted,
    completed_at = now(),
    failure_reason = null,
    updated_at = now()
  where id = p_run_id
    and status = 'building';
  if not found then
    raise exception 'Structure run was not BUILDING at cutover';
  end if;

  update public.legal_ingestion_jobs
  set
    active_structure_run_id = p_run_id,
    structure_candidate_count = p_expected_count,
    warning_count = greatest(coalesce(p_warning_count, 0), 0),
    status = p_job_status,
    last_error = case
      when status = 'extraction_failed' then last_error
      else p_last_error
    end,
    updated_at = now()
  where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

comment on function public.legal_ingestion_activate_structure_run(uuid, uuid, integer, integer, text, text) is
  'TAX-627 one-transaction cutover: mark run READY, switch job.active_structure_run_id, set structure_candidate_count, supersede previous READY run. Does not write tax_legal_nodes.';

revoke all on function public.legal_ingestion_fail_structure_run(uuid, text) from public, anon, authenticated;
grant execute on function public.legal_ingestion_fail_structure_run(uuid, text) to service_role;
revoke all on function public.legal_ingestion_activate_structure_run(uuid, uuid, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.legal_ingestion_activate_structure_run(uuid, uuid, integer, integer, text, text) to service_role;

alter table public.legal_ingestion_structure_runs enable row level security;
alter table public.legal_ingestion_structure_runs force row level security;
revoke all on table public.legal_ingestion_structure_runs from anon, authenticated, public;
grant select, insert, update, delete on table public.legal_ingestion_structure_runs to service_role;

-- Backfill existing staging rows into one explicit run per job.
-- Matching job.structure_candidate_count → READY + active.
-- Mismatch (including the current 2147 vs 397 DEV job) → FAILED, not active.
-- Does not delete candidates. Does not write canonical law.
do $$
declare
  r record;
  v_count integer;
  v_run_id uuid;
  v_status text;
  v_layout boolean;
begin
  for r in
    select j.id, j.document_id, j.country_code, j.tax_source_id, j.structure_candidate_count, j.last_error
    from public.legal_ingestion_jobs j
  loop
    select count(*)::integer into v_count
    from public.legal_ingestion_candidates c
    where c.job_id = r.id
      and c.structure_run_id is null;

    if v_count = 0 then
      continue;
    end if;

    if v_count = r.structure_candidate_count then
      v_status := 'ready';
    else
      v_status := 'failed';
    end if;

    v_layout := coalesce(r.last_error like '%"layout_used":true%', false);

    insert into public.legal_ingestion_structure_runs (
      job_id,
      document_id,
      country_code,
      tax_source_id,
      status,
      detector_version,
      layout_used,
      expected_candidate_count,
      persisted_candidate_count,
      started_at,
      completed_at,
      failure_reason
    ) values (
      r.id,
      r.document_id,
      r.country_code,
      r.tax_source_id,
      v_status,
      'legacy-pre-627',
      v_layout,
      r.structure_candidate_count,
      v_count,
      now(),
      now(),
      case when v_status = 'failed' then 'legacy_incomplete_or_mismatched_count' else null end
    )
    returning id into v_run_id;

    update public.legal_ingestion_candidates
    set structure_run_id = v_run_id
    where job_id = r.id
      and structure_run_id is null;

    if v_status = 'ready' then
      update public.legal_ingestion_jobs
      set active_structure_run_id = v_run_id
      where id = r.id;
    end if;
  end loop;
end $$;
