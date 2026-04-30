-- Client workspace: מיסים (tax settings) — single row per org+client, encrypted payment blobs, audit trail.

create table if not exists public.client_tax_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,

  vat_type text null check (vat_type is null or vat_type in ('yes', 'no', 'patur')),
  vat_frequency text null check (vat_frequency is null or vat_frequency in ('monthly', 'bi_monthly', 'not_relevant')),
  vat_due_type text null check (vat_due_type is null or vat_due_type in ('pcn', 'regular', 'not_relevant')),

  income_tax_advance_enabled boolean not null default false,
  income_tax_advance_percent numeric,
  income_tax_advance_frequency text null check (
    income_tax_advance_frequency is null or income_tax_advance_frequency in ('monthly', 'bi_monthly')
  ),

  income_tax_deductions_enabled boolean not null default false,
  income_tax_deductions_file_number text null,

  national_insurance_type text null check (
    national_insurance_type is null or national_insurance_type in ('yes', 'not_applicable')
  ),
  national_insurance_monthly_amount numeric null,

  national_insurance_deductions_file_number text null,

  vat_payment_method text null check (
    vat_payment_method is null or vat_payment_method in ('credit', 'bank_order', 'voucher', 'other')
  ),
  vat_payment_details_encrypted text null,
  vat_other_payment_text text null,
  vat_card_last4 text null,
  vat_card_expiry_masked text null,

  income_tax_payment_method text null check (
    income_tax_payment_method is null or income_tax_payment_method in ('credit', 'bank_order', 'voucher', 'other')
  ),
  income_tax_payment_details_encrypted text null,
  income_tax_other_payment_text text null,
  income_tax_card_last4 text null,
  income_tax_card_expiry_masked text null,

  notes text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, client_id)
);

create index if not exists idx_client_tax_settings_org_client
  on public.client_tax_settings (organization_id, client_id);

create trigger client_tax_settings_updated_at
before update on public.client_tax_settings
for each row execute function public.set_updated_at();

alter table public.client_tax_settings enable row level security;

create policy "client_tax_settings_select_org_member" on public.client_tax_settings
  for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_tax_settings_insert_org_member" on public.client_tax_settings
  for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_tax_settings_update_org_member" on public.client_tax_settings
  for update to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()))
  with check (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_tax_settings_delete_org_member" on public.client_tax_settings
  for delete to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

-- Field-level audit for tax settings (API also writes audit_log for sensitive access).
create table if not exists public.client_tax_settings_event_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  action_type text not null,
  field_changed text not null,
  old_value text null,
  new_value text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_client_tax_settings_event_log_client
  on public.client_tax_settings_event_log (organization_id, client_id, created_at desc);

alter table public.client_tax_settings_event_log enable row level security;

create policy "client_tax_settings_event_log_select_org_member" on public.client_tax_settings_event_log
  for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy "client_tax_settings_event_log_insert_service" on public.client_tax_settings_event_log
  for insert to authenticated
  with check (organization_id in (select public.organizations_for_current_auth_user()));

comment on table public.client_tax_settings is 'Nodex client workspace מיסים tab; payment card data encrypted at rest (application layer).';
comment on column public.client_tax_settings.vat_payment_details_encrypted is 'AES-GCM ciphertext (base64), never expose to client list views';
