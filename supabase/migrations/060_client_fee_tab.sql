-- שכ״ט tab: agreement, service lines, price audit history.

insert into public.permissions (code, name, domain)
values
  ('fees_tab.view', 'View client fees (שכ״ט) tab', 'client_operations'),
  ('fees_tab.edit', 'Edit client fees (שכ״ט) tab', 'client_operations')
on conflict (code) do nothing;

insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner', 'fees_tab.view'),
  ('owner', 'fees_tab.edit'),
  ('admin', 'fees_tab.view'),
  ('admin', 'fees_tab.edit'),
  ('staff', 'fees_tab.view'),
  ('staff', 'fees_tab.edit'),
  ('viewer', 'fees_tab.view')
on conflict (role_code, permission_code) do nothing;

create table if not exists public.client_fee_agreements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  read_model_version int not null default 1,
  has_agreement boolean not null default false,
  agreement_start_date date null,
  agreement_end_date date null,
  auto_renewal boolean not null default false,
  renewal_period text null,
  renewal_period_other text null,
  agreement_status text null,
  pricing_basis text null,
  pricing_basis_other text null,
  price_set_by text null,
  not_included_in_price text null,
  last_price_update_date date null,
  agreement_notes text null,
  discount_has boolean not null default false,
  discount_type text null,
  discount_percent numeric(7, 4) null,
  discount_amount_ils numeric(14, 2) null,
  reminder_days_before int null,
  default_end_action text null,
  end_action_increase_percent numeric(7, 4) null,
  end_action_increase_amount_ils numeric(14, 2) null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id) on delete set null,
  unique (organization_id, client_id)
);

create index if not exists idx_client_fee_agreements_org_client
  on public.client_fee_agreements (organization_id, client_id);

create trigger client_fee_agreements_updated_at
  before update on public.client_fee_agreements
  for each row execute function public.set_updated_at();

alter table public.client_fee_agreements enable row level security;

create policy "client_fee_agreements_select_org_member"
  on public.client_fee_agreements for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_fee_agreements_insert_org_member"
  on public.client_fee_agreements for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_fee_agreements_update_org_member"
  on public.client_fee_agreements for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_fee_agreements_delete_org_member"
  on public.client_fee_agreements for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create table if not exists public.client_fee_service_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  agreement_id uuid not null references public.client_fee_agreements(id) on delete cascade,
  line_kind text not null check (line_kind in ('built_in', 'custom')),
  catalog_code text null,
  display_name_he text not null,
  charging_type text not null,
  price_ils numeric(14, 2) not null default 0,
  payslip_count int null,
  unit_price_ils numeric(14, 2) null,
  line_total_ils numeric(14, 2) null,
  is_active boolean not null default true,
  line_note text null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_client_fee_service_lines_agreement
  on public.client_fee_service_lines (agreement_id, sort_order);

alter table public.client_fee_service_lines enable row level security;

create policy "client_fee_service_lines_select_org_member"
  on public.client_fee_service_lines for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_fee_service_lines_insert_org_member"
  on public.client_fee_service_lines for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_fee_service_lines_update_org_member"
  on public.client_fee_service_lines for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_fee_service_lines_delete_org_member"
  on public.client_fee_service_lines for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create table if not exists public.client_fee_price_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  agreement_id uuid not null references public.client_fee_agreements(id) on delete cascade,
  service_line_id uuid null references public.client_fee_service_lines(id) on delete set null,
  service_display_name text not null default '',
  old_price_ils numeric(14, 2) null,
  new_price_ils numeric(14, 2) null,
  effective_from date null,
  effective_to date null,
  change_reason text not null,
  changed_by uuid null references public.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  notes text null
);

create index if not exists idx_client_fee_price_history_client_changed
  on public.client_fee_price_history (organization_id, client_id, changed_at desc);

alter table public.client_fee_price_history enable row level security;

create policy "client_fee_price_history_select_org_member"
  on public.client_fee_price_history for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_fee_price_history_insert_org_member"
  on public.client_fee_price_history for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));
