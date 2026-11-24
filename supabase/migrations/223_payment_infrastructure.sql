-- Payment Infrastructure foundation.
-- PSP integration records only. Not an Accounting Base journal. Not a second invoice ledger.
-- Catalog adapters stay catalog_only until a signed real adapter exists.

insert into public.permissions (code, name, domain) values
  ('payments.office.read', 'View office payment settings', 'core'),
  ('payments.office.connect', 'Manage office payment provider connection', 'core')
on conflict (code) do nothing;

insert into public.rbac_role_permissions (role_code, permission_code) values
  ('owner', 'payments.office.read'),
  ('admin', 'payments.office.read'),
  ('owner', 'payments.office.connect'),
  ('admin', 'payments.office.connect')
on conflict (role_code, permission_code) do nothing;

create table if not exists public.payment_provider_catalog (
  code text primary key,
  display_name text not null,
  adapter_status text not null default 'catalog_only'
    check (adapter_status in ('catalog_only', 'ready')),
  supported_scenarios text[] not null default '{}',
  supported_countries text[] not null default '{}',
  environment_modes text[] not null default array['test','live'],
  capability_hosted_checkout boolean not null default false,
  capability_payment_links boolean not null default false,
  capability_recurring_billing boolean not null default false,
  capability_refunds boolean not null default false,
  capability_webhook_verification boolean not null default false,
  capability_merchant_onboarding boolean not null default false,
  capability_connected_accounts boolean not null default false,
  capability_split_payments boolean not null default false,
  capability_international_cards boolean not null default false,
  capability_three_d_secure boolean not null default false,
  capability_platform_fee boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists payment_provider_catalog_updated_at on public.payment_provider_catalog;
create trigger payment_provider_catalog_updated_at
  before update on public.payment_provider_catalog
  for each row execute function public.set_updated_at();

insert into public.payment_provider_catalog (
  code, display_name, adapter_status, supported_scenarios, supported_countries, notes
) values
  ('tranzila', 'Tranzila', 'catalog_only', array['PLATFORM_BILLING','OFFICE_EXTERNAL','OFFICE_EMBEDDED'], array['IL'], 'Listed only. No signed adapter.'),
  ('cardcom', 'Cardcom', 'catalog_only', array['PLATFORM_BILLING','OFFICE_EXTERNAL','OFFICE_EMBEDDED'], array['IL'], 'Listed only. No signed adapter.'),
  ('grow', 'Grow', 'catalog_only', array['PLATFORM_BILLING','OFFICE_EXTERNAL','OFFICE_EMBEDDED'], array['IL'], 'Listed only. No signed adapter.'),
  ('payme', 'PayMe', 'catalog_only', array['PLATFORM_BILLING','OFFICE_EXTERNAL','OFFICE_EMBEDDED'], array['IL'], 'Listed only. No signed adapter.'),
  ('sumit', 'SUMIT', 'catalog_only', array['PLATFORM_BILLING','OFFICE_EXTERNAL','OFFICE_EMBEDDED'], array['IL'], 'Listed only. No signed adapter.')
on conflict (code) do nothing;

create table if not exists public.platform_payment_provider_credentials (
  provider_code text primary key references public.payment_provider_catalog(code) on delete restrict,
  environment_mode text not null check (environment_mode in ('test', 'live')),
  credentials_encrypted text not null,
  credentials_configured boolean not null default true,
  updated_by_user_id uuid null,
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_payment_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scenario text not null check (scenario in ('OFFICE_EXTERNAL', 'OFFICE_EMBEDDED')),
  provider_code text not null references public.payment_provider_catalog(code) on delete restrict,
  status text not null default 'unavailable'
    check (status in ('unavailable', 'draft', 'pending_kyc', 'pending_provider', 'active', 'disabled', 'rejected')),
  environment_mode text not null default 'test' check (environment_mode in ('test', 'live')),
  credentials_encrypted text null,
  credentials_configured boolean not null default false,
  kyc_status text not null default 'not_started'
    check (kyc_status in ('not_started', 'pending', 'approved', 'rejected', 'unavailable')),
  merchant_reference text null,
  last_error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, scenario)
);

drop trigger if exists organization_payment_connections_updated_at on public.organization_payment_connections;
create trigger organization_payment_connections_updated_at
  before update on public.organization_payment_connections
  for each row execute function public.set_updated_at();

create table if not exists public.staff_seat_purchase_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quantity int not null check (quantity > 0),
  currency char(3) not null,
  unit_price_net numeric(12,2) not null,
  net_amount numeric(12,2) not null,
  vat_rate numeric(8,6) not null,
  vat_amount numeric(12,2) not null,
  total_amount numeric(12,2) not null,
  price_source text not null check (price_source in ('office_commercial_terms', 'platform_catalog')),
  catalog_unit_price_net numeric(12,2) not null,
  billing_period text not null check (billing_period in ('month', 'year')),
  status text not null default 'quoted'
    check (status in ('quoted', 'pending_payment', 'cancelled', 'expired', 'failed', 'paid_pending_activation', 'activated')),
  idempotency_key text not null,
  expires_at timestamptz not null,
  payment_transaction_id uuid null,
  activated_at timestamptz null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create unique index if not exists staff_seat_purchase_intents_one_open
  on public.staff_seat_purchase_intents (organization_id)
  where status in ('quoted', 'pending_payment');

drop trigger if exists staff_seat_purchase_intents_updated_at on public.staff_seat_purchase_intents;
create trigger staff_seat_purchase_intents_updated_at
  before update on public.staff_seat_purchase_intents
  for each row execute function public.set_updated_at();

create table if not exists public.platform_billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('staff_seats', 'module')),
  status text not null default 'unavailable'
    check (status in ('pending', 'active', 'past_due', 'cancelled', 'unavailable')),
  quantity int not null default 0 check (quantity >= 0),
  currency char(3) not null default 'ILS',
  unit_price_net numeric(12,2) not null default 0,
  billing_period text not null default 'month' check (billing_period in ('month', 'year')),
  current_period_start date null,
  current_period_end date null,
  cancel_at_period_end boolean not null default false,
  provider_code text null references public.payment_provider_catalog(code),
  last_intent_id uuid null references public.staff_seat_purchase_intents(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, kind)
);

drop trigger if exists platform_billing_subscriptions_updated_at on public.platform_billing_subscriptions;
create trigger platform_billing_subscriptions_updated_at
  before update on public.platform_billing_subscriptions
  for each row execute function public.set_updated_at();

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  seller_context text not null check (seller_context in ('nodexpro_platform', 'office')),
  scenario text not null check (scenario in ('PLATFORM_BILLING', 'OFFICE_EXTERNAL', 'OFFICE_EMBEDDED')),
  provider_code text null references public.payment_provider_catalog(code),
  provider_event_id text null,
  status text not null check (status in ('created', 'pending', 'verified', 'failed', 'refunded', 'cancelled')),
  amount numeric(12,2) not null,
  currency char(3) not null,
  income_document_id uuid null,
  staff_seat_purchase_intent_id uuid null references public.staff_seat_purchase_intents(id),
  verified_at timestamptz null,
  created_at timestamptz not null default now()
);

create unique index if not exists payment_transactions_provider_event_unique
  on public.payment_transactions (provider_code, provider_event_id)
  where provider_code is not null and provider_event_id is not null;

create table if not exists public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_code text not null,
  provider_event_id text not null,
  signature_ok boolean not null default false,
  processed boolean not null default false,
  payload_digest text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz null,
  unique (provider_code, provider_event_id)
);

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  seller_context text not null check (seller_context in ('nodexpro_platform', 'office')),
  income_document_id uuid null,
  staff_seat_purchase_intent_id uuid null references public.staff_seat_purchase_intents(id),
  status text not null default 'unavailable'
    check (status in ('unavailable', 'created', 'sent', 'paid', 'cancelled', 'expired')),
  checkout_url text null,
  created_at timestamptz not null default now()
);

comment on table public.payment_transactions is
  'PSP integration records. Accounting Base remains financial truth. Documents are not accounting entries.';
comment on table public.staff_seat_purchase_intents is
  'Seat purchase intents. Entitlement grows only after verified payment via apply_organization_staff_seat_commercial_terms.';

alter table public.payment_provider_catalog enable row level security;
alter table public.payment_provider_catalog force row level security;
alter table public.platform_payment_provider_credentials enable row level security;
alter table public.platform_payment_provider_credentials force row level security;
alter table public.organization_payment_connections enable row level security;
alter table public.organization_payment_connections force row level security;
alter table public.staff_seat_purchase_intents enable row level security;
alter table public.staff_seat_purchase_intents force row level security;
alter table public.platform_billing_subscriptions enable row level security;
alter table public.platform_billing_subscriptions force row level security;
alter table public.payment_transactions enable row level security;
alter table public.payment_transactions force row level security;
alter table public.payment_webhook_events enable row level security;
alter table public.payment_webhook_events force row level security;
alter table public.payment_requests enable row level security;
alter table public.payment_requests force row level security;

revoke all on public.platform_payment_provider_credentials from anon, authenticated;
revoke all on public.payment_webhook_events from anon, authenticated;

create policy payment_provider_catalog_select_auth
  on public.payment_provider_catalog for select to authenticated
  using (true);

create policy organization_payment_connections_org_member
  on public.organization_payment_connections for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy staff_seat_purchase_intents_org_member
  on public.staff_seat_purchase_intents for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy platform_billing_subscriptions_org_member
  on public.platform_billing_subscriptions for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy payment_transactions_org_member
  on public.payment_transactions for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));

create policy payment_requests_org_member
  on public.payment_requests for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
