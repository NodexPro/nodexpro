-- Accounting Base schema hardening patch.
-- Scope: constraints/integrity/RLS corrections for accounting_* tables only.
-- No module integrations, no API/UI/runtime feature logic.

-- ==================================================
-- PART 1: NEGATIVE VALUES RULE
-- ==================================================

alter table if exists public.accounting_entries
  drop constraint if exists accounting_entries_amount_check;

alter table if exists public.accounting_entries
  add constraint accounting_entries_amount_non_negative_chk
  check (amount >= 0);

comment on column public.accounting_entries.amount is
  'Negative financial results must be computed in aggregates/reports, not stored in entries';

-- ==================================================
-- PART 2: POSTING STATE CONSISTENCY
-- ==================================================

alter table if exists public.accounting_entries
  drop constraint if exists accounting_entries_finalized_at_finalized_by_check;

alter table if exists public.accounting_entries
  add constraint accounting_entries_posting_state_finalize_consistency_chk
  check (
    (posting_state = 'draft' and finalized_at is null and finalized_by is null)
    or
    (posting_state = 'finalized' and finalized_at is not null and finalized_by is not null)
  );

-- ==================================================
-- PART 3: STATUS VS ARCHIVE NORMALIZATION
-- Safe variant: keep is_archived physically, enforce derived consistency.
-- ==================================================

update public.accounting_entries
set status = 'archived'
where status = 'cancelled';

alter table if exists public.accounting_entries
  drop constraint if exists accounting_entries_status_check;

alter table if exists public.accounting_entries
  add constraint accounting_entries_status_limited_chk
  check (status in ('active', 'archived'));

alter table if exists public.accounting_entries
  add constraint accounting_entries_status_archive_consistency_chk
  check (
    (status = 'active' and is_archived = false)
    or
    (status = 'archived' and is_archived = true)
  );

comment on column public.accounting_entries.is_archived is
  'Deprecated duplicate flag; kept for compatibility. Must always mirror status (active=false, archived=true).';

-- ==================================================
-- PART 4: CROSS-TENANT DATA INTEGRITY
-- ==================================================

-- Helper unique indexes for composite FKs.
create unique index if not exists uq_accounting_periods_id_org
  on public.accounting_periods (id, organization_id);

create unique index if not exists uq_clients_id_org
  on public.clients (id, organization_id);

create unique index if not exists uq_accounting_entries_id_org
  on public.accounting_entries (id, organization_id);

-- Enforce period/client org alignment on entries.
alter table if exists public.accounting_entries
  drop constraint if exists accounting_entries_period_org_fk;

alter table if exists public.accounting_entries
  add constraint accounting_entries_period_org_fk
  foreign key (period_id, organization_id)
  references public.accounting_periods (id, organization_id)
  on delete restrict;

alter table if exists public.accounting_entries
  drop constraint if exists accounting_entries_client_org_fk;

alter table if exists public.accounting_entries
  add constraint accounting_entries_client_org_fk
  foreign key (client_id, organization_id)
  references public.clients (id, organization_id)
  on delete restrict;

-- Enforce org alignment for dependent accounting tables.
alter table if exists public.accounting_entry_links
  drop constraint if exists accounting_entry_links_entry_org_fk;

alter table if exists public.accounting_entry_links
  add constraint accounting_entry_links_entry_org_fk
  foreign key (accounting_entry_id, organization_id)
  references public.accounting_entries (id, organization_id)
  on delete cascade;

alter table if exists public.accounting_summaries
  drop constraint if exists accounting_summaries_period_org_fk;

alter table if exists public.accounting_summaries
  add constraint accounting_summaries_period_org_fk
  foreign key (period_id, organization_id)
  references public.accounting_periods (id, organization_id)
  on delete cascade;

alter table if exists public.accounting_activity_timeline
  drop constraint if exists accounting_activity_timeline_entry_org_fk;

alter table if exists public.accounting_activity_timeline
  add constraint accounting_activity_timeline_entry_org_fk
  foreign key (accounting_entry_id, organization_id)
  references public.accounting_entries (id, organization_id)
  on delete cascade;

-- Category org/system rule cannot be expressed as a single FK because system categories have organization_id = null.
-- Enforce via trigger-level invariant.
create or replace function public.accounting_entries_enforce_category_tenant()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.accounting_categories c
    where c.id = new.category_id
      and (
        c.is_system = true
        or c.organization_id = new.organization_id
      )
  ) then
    raise exception 'Cross-tenant category reference is forbidden';
  end if;

  return new;
end;
$$;

drop trigger if exists accounting_entries_category_tenant_guard on public.accounting_entries;
create trigger accounting_entries_category_tenant_guard
  before insert or update on public.accounting_entries
  for each row execute function public.accounting_entries_enforce_category_tenant();

-- Tenant immutability guard: organization_id cannot be changed on update.
create or replace function public.accounting_base_guard_org_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists accounting_periods_org_immutable_guard on public.accounting_periods;
create trigger accounting_periods_org_immutable_guard
  before update on public.accounting_periods
  for each row execute function public.accounting_base_guard_org_immutable();

drop trigger if exists accounting_categories_org_immutable_guard on public.accounting_categories;
create trigger accounting_categories_org_immutable_guard
  before update on public.accounting_categories
  for each row execute function public.accounting_base_guard_org_immutable();

drop trigger if exists accounting_entries_org_immutable_guard on public.accounting_entries;
create trigger accounting_entries_org_immutable_guard
  before update on public.accounting_entries
  for each row execute function public.accounting_base_guard_org_immutable();

drop trigger if exists accounting_entry_links_org_immutable_guard on public.accounting_entry_links;
create trigger accounting_entry_links_org_immutable_guard
  before update on public.accounting_entry_links
  for each row execute function public.accounting_base_guard_org_immutable();

drop trigger if exists accounting_summaries_org_immutable_guard on public.accounting_summaries;
create trigger accounting_summaries_org_immutable_guard
  before update on public.accounting_summaries
  for each row execute function public.accounting_base_guard_org_immutable();

drop trigger if exists accounting_activity_timeline_org_immutable_guard on public.accounting_activity_timeline;
create trigger accounting_activity_timeline_org_immutable_guard
  before update on public.accounting_activity_timeline
  for each row execute function public.accounting_base_guard_org_immutable();

-- ==================================================
-- PART 5: RLS COMPLETE COVERAGE
-- ==================================================

alter table public.accounting_periods enable row level security;
alter table public.accounting_categories enable row level security;
alter table public.accounting_entries enable row level security;
alter table public.accounting_entry_links enable row level security;
alter table public.accounting_summaries enable row level security;
alter table public.accounting_activity_timeline enable row level security;

drop policy if exists "accounting_periods_select_org_member" on public.accounting_periods;
drop policy if exists "accounting_periods_insert_org_member" on public.accounting_periods;
drop policy if exists "accounting_periods_update_org_member" on public.accounting_periods;
drop policy if exists "accounting_periods_delete_org_member" on public.accounting_periods;

drop policy if exists "accounting_categories_select_org_or_system_member" on public.accounting_categories;
drop policy if exists "accounting_categories_insert_org_member" on public.accounting_categories;
drop policy if exists "accounting_categories_update_org_or_system_member" on public.accounting_categories;
drop policy if exists "accounting_categories_delete_org_member" on public.accounting_categories;

drop policy if exists "accounting_entries_select_org_member" on public.accounting_entries;
drop policy if exists "accounting_entries_insert_org_member" on public.accounting_entries;
drop policy if exists "accounting_entries_update_org_member" on public.accounting_entries;
drop policy if exists "accounting_entries_delete_org_member" on public.accounting_entries;

drop policy if exists "accounting_entry_links_select_org_member" on public.accounting_entry_links;
drop policy if exists "accounting_entry_links_insert_org_member" on public.accounting_entry_links;
drop policy if exists "accounting_entry_links_update_org_member" on public.accounting_entry_links;
drop policy if exists "accounting_entry_links_delete_org_member" on public.accounting_entry_links;

drop policy if exists "accounting_summaries_select_org_member" on public.accounting_summaries;
drop policy if exists "accounting_summaries_insert_org_member" on public.accounting_summaries;
drop policy if exists "accounting_summaries_update_org_member" on public.accounting_summaries;
drop policy if exists "accounting_summaries_delete_org_member" on public.accounting_summaries;

drop policy if exists "accounting_activity_timeline_select_org_member" on public.accounting_activity_timeline;
drop policy if exists "accounting_activity_timeline_insert_org_member" on public.accounting_activity_timeline;
drop policy if exists "accounting_activity_timeline_update_org_member" on public.accounting_activity_timeline;
drop policy if exists "accounting_activity_timeline_delete_org_member" on public.accounting_activity_timeline;

create policy "accounting_periods_select_org_member"
  on public.accounting_periods for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "accounting_periods_insert_org_member"
  on public.accounting_periods for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "accounting_periods_update_org_member"
  on public.accounting_periods for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "accounting_periods_delete_org_member"
  on public.accounting_periods for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "accounting_categories_select_org_or_system_member"
  on public.accounting_categories for select to authenticated
  using (
    is_system = true
    or organization_id in (select public.organizations_for_current_auth_user())
  );
create policy "accounting_categories_insert_org_member_only"
  on public.accounting_categories for insert to authenticated
  with check (
    is_system = false
    and organization_id in (select public.organizations_for_current_auth_user())
  );
create policy "accounting_categories_update_org_member_only"
  on public.accounting_categories for update to authenticated
  using (
    is_system = false
    and organization_id in (select public.organizations_for_current_auth_user())
  )
  with check (
    is_system = false
    and organization_id in (select public.organizations_for_current_auth_user())
  );
create policy "accounting_categories_delete_org_member"
  on public.accounting_categories for delete to authenticated
  using (
    is_system = false
    and organization_id in (select public.organizations_for_current_auth_user())
  );

create policy "accounting_entries_select_org_member"
  on public.accounting_entries for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "accounting_entries_insert_org_member"
  on public.accounting_entries for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "accounting_entries_update_org_member"
  on public.accounting_entries for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "accounting_entries_delete_org_member"
  on public.accounting_entries for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "accounting_entry_links_select_org_member"
  on public.accounting_entry_links for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "accounting_entry_links_insert_org_member"
  on public.accounting_entry_links for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "accounting_entry_links_update_org_member"
  on public.accounting_entry_links for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "accounting_entry_links_delete_org_member"
  on public.accounting_entry_links for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "accounting_summaries_select_org_member"
  on public.accounting_summaries for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "accounting_summaries_insert_org_member"
  on public.accounting_summaries for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "accounting_summaries_update_org_member"
  on public.accounting_summaries for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "accounting_summaries_delete_org_member"
  on public.accounting_summaries for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "accounting_activity_timeline_select_org_member"
  on public.accounting_activity_timeline for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
create policy "accounting_activity_timeline_insert_org_member"
  on public.accounting_activity_timeline for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "accounting_activity_timeline_update_org_member"
  on public.accounting_activity_timeline for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));
create policy "accounting_activity_timeline_delete_org_member"
  on public.accounting_activity_timeline for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
