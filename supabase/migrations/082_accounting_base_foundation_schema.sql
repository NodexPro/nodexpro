-- Accounting Base foundation schema (Phase 1).
-- Scope: new accounting_base tables only.
-- No API/UI/module integration in this migration.

create table if not exists public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  period_label text not null,
  status text not null check (status in ('open', 'locked', 'closed')),
  base_currency char(3) not null,
  closed_at timestamptz null,
  closed_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_start <= period_end),
  unique (organization_id, period_label)
);

create index if not exists idx_accounting_periods_org
  on public.accounting_periods (organization_id);

create index if not exists idx_accounting_periods_org_status
  on public.accounting_periods (organization_id, status);

create index if not exists idx_accounting_periods_org_range
  on public.accounting_periods (organization_id, period_start, period_end);

create trigger accounting_periods_updated_at
  before update on public.accounting_periods
  for each row execute function public.set_updated_at();

create table if not exists public.accounting_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null references public.organizations(id) on delete cascade,
  parent_category_id uuid null references public.accounting_categories(id) on delete set null,
  code text not null,
  name text not null,
  category_type text not null check (category_type in ('income', 'expense', 'asset', 'liability', 'equity', 'other')),
  status text not null check (status in ('active', 'inactive')),
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (btrim(code) <> ''),
  check (
    (is_system = true and organization_id is null)
    or
    (is_system = false and organization_id is not null)
  )
);

create unique index if not exists uq_accounting_categories_org_code
  on public.accounting_categories (organization_id, code)
  where is_system = false;

create unique index if not exists uq_accounting_categories_system_code
  on public.accounting_categories (code)
  where is_system = true;

create index if not exists idx_accounting_categories_org
  on public.accounting_categories (organization_id);

create index if not exists idx_accounting_categories_type_status
  on public.accounting_categories (category_type, status);

create trigger accounting_categories_updated_at
  before update on public.accounting_categories
  for each row execute function public.set_updated_at();

create table if not exists public.accounting_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_id uuid not null references public.accounting_periods(id) on delete restrict,
  category_id uuid not null references public.accounting_categories(id) on delete restrict,
  client_id uuid null references public.clients(id) on delete set null,
  entry_type text not null check (entry_type in ('income', 'expense', 'adjustment', 'transfer', 'other')),
  status text not null check (status in ('active', 'archived', 'cancelled')),
  posting_state text not null check (posting_state in ('draft', 'finalized')),
  description text null,
  entry_date date not null,
  amount numeric(14,2) not null check (amount >= 0),
  currency char(3) not null,
  direction text not null check (direction in ('debit', 'credit')),
  source_type text null,
  created_by uuid not null references public.users(id) on delete restrict,
  finalized_at timestamptz null,
  finalized_by uuid null references public.users(id) on delete set null,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (finalized_at is null and finalized_by is null)
    or
    (finalized_at is not null and finalized_by is not null and posting_state = 'finalized')
  )
);

create index if not exists idx_accounting_entries_org
  on public.accounting_entries (organization_id);

create index if not exists idx_accounting_entries_period_id
  on public.accounting_entries (period_id);

create index if not exists idx_accounting_entries_category_id
  on public.accounting_entries (category_id);

create index if not exists idx_accounting_entries_org_period
  on public.accounting_entries (organization_id, period_id);

create index if not exists idx_accounting_entries_org_category_date
  on public.accounting_entries (organization_id, category_id, entry_date);

create index if not exists idx_accounting_entries_org_posting_state
  on public.accounting_entries (organization_id, posting_state);

create index if not exists idx_accounting_entries_org_status
  on public.accounting_entries (organization_id, status);

create trigger accounting_entries_updated_at
  before update on public.accounting_entries
  for each row execute function public.set_updated_at();

create table if not exists public.accounting_entry_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  accounting_entry_id uuid not null references public.accounting_entries(id) on delete cascade,
  target_entity_type text not null check (target_entity_type in ('document', 'client', 'module_entity', 'other')),
  target_entity_id uuid not null,
  relation_type text not null check (relation_type in ('evidence', 'source', 'context', 'reference')),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, accounting_entry_id, target_entity_type, target_entity_id, relation_type)
);

create index if not exists idx_accounting_entry_links_org
  on public.accounting_entry_links (organization_id);

create index if not exists idx_accounting_entry_links_entry_id
  on public.accounting_entry_links (accounting_entry_id);

create index if not exists idx_accounting_entry_links_org_target
  on public.accounting_entry_links (organization_id, target_entity_type, target_entity_id);

create table if not exists public.accounting_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_id uuid not null references public.accounting_periods(id) on delete cascade,
  summary_scope text not null check (summary_scope in ('period', 'category', 'client', 'global')),
  summary_key text not null,
  amount_total numeric(14,2) not null default 0,
  currency char(3) not null,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, period_id, summary_scope, summary_key, currency)
);

create index if not exists idx_accounting_summaries_org
  on public.accounting_summaries (organization_id);

create index if not exists idx_accounting_summaries_period_id
  on public.accounting_summaries (period_id);

create index if not exists idx_accounting_summaries_org_scope_key
  on public.accounting_summaries (organization_id, summary_scope, summary_key);

create index if not exists idx_accounting_summaries_org_calculated_at
  on public.accounting_summaries (organization_id, calculated_at);

create trigger accounting_summaries_updated_at
  before update on public.accounting_summaries
  for each row execute function public.set_updated_at();

create table if not exists public.accounting_activity_timeline (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  accounting_entry_id uuid not null references public.accounting_entries(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  payload_json jsonb not null default '{}'::jsonb check (jsonb_typeof(payload_json) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists idx_accounting_activity_timeline_org
  on public.accounting_activity_timeline (organization_id);

create index if not exists idx_accounting_activity_timeline_entry_id
  on public.accounting_activity_timeline (accounting_entry_id);

create index if not exists idx_accounting_activity_timeline_org_event
  on public.accounting_activity_timeline (organization_id, event_type, created_at);

alter table public.accounting_periods enable row level security;
alter table public.accounting_categories enable row level security;
alter table public.accounting_entries enable row level security;
alter table public.accounting_entry_links enable row level security;
alter table public.accounting_summaries enable row level security;
alter table public.accounting_activity_timeline enable row level security;

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
create policy "accounting_categories_insert_org_member"
  on public.accounting_categories for insert to authenticated
  with check (
    (is_system = true and organization_id is null)
    or organization_id in (select public.organizations_for_current_auth_user())
  );
create policy "accounting_categories_update_org_or_system_member"
  on public.accounting_categories for update to authenticated
  using (
    (is_system = true and organization_id is null)
    or organization_id in (select public.organizations_for_current_auth_user())
  )
  with check (
    (is_system = true and organization_id is null)
    or organization_id in (select public.organizations_for_current_auth_user())
  );
create policy "accounting_categories_delete_org_member"
  on public.accounting_categories for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

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
