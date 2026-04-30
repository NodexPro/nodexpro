-- Per-client custom fields for accounting block "ניהול הוצאות" (expense_management), right column only.
-- Definitions + values in one row; max 5 enforced in API.

create table if not exists public.client_accounting_expense_mgmt_custom_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  field_key text not null,
  label_he text not null check (char_length(label_he) >= 1 and char_length(label_he) <= 80),
  field_type text not null check (field_type in ('text', 'enum_single', 'boolean')),
  options_json jsonb null,
  value_text text null,
  value_enum text null,
  value_bool boolean null,
  sort_order int not null default 0 check (sort_order >= 0 and sort_order < 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null references public.users(id) on delete set null,
  updated_by uuid null references public.users(id) on delete set null,
  unique (organization_id, client_id, field_key)
);

comment on table public.client_accounting_expense_mgmt_custom_fields is 'Custom fields for expense_management block (definitions + values); API enforces max 5 per org+client.';

create index if not exists idx_client_acct_em_cf_org_client
  on public.client_accounting_expense_mgmt_custom_fields (organization_id, client_id, sort_order);

create trigger client_accounting_expense_mgmt_custom_fields_updated_at
  before update on public.client_accounting_expense_mgmt_custom_fields
  for each row execute function public.set_updated_at();

alter table public.client_accounting_expense_mgmt_custom_fields enable row level security;

create policy "client_acct_em_cf_select_org_member"
  on public.client_accounting_expense_mgmt_custom_fields for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_acct_em_cf_insert_org_member"
  on public.client_accounting_expense_mgmt_custom_fields for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_acct_em_cf_update_org_member"
  on public.client_accounting_expense_mgmt_custom_fields for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_acct_em_cf_delete_org_member"
  on public.client_accounting_expense_mgmt_custom_fields for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
