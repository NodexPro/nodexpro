-- Module purchase intents for PLATFORM_BILLING.
-- Activation stays on existing organization_module_subscriptions after verified payment.
-- Not an Accounting Base journal.

create table if not exists public.module_purchase_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_id uuid not null references public.modules(id) on delete restrict,
  module_plan_id uuid not null references public.module_plans(id) on delete restrict,
  currency char(3) not null,
  unit_price_net numeric(12,2) not null,
  net_amount numeric(12,2) not null,
  vat_rate numeric(8,6) not null,
  vat_amount numeric(12,2) not null,
  total_amount numeric(12,2) not null,
  vat_authoritative boolean not null default false,
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

create unique index if not exists module_purchase_intents_one_open
  on public.module_purchase_intents (organization_id, module_id)
  where status in ('quoted', 'pending_payment');

drop trigger if exists module_purchase_intents_updated_at on public.module_purchase_intents;
create trigger module_purchase_intents_updated_at
  before update on public.module_purchase_intents
  for each row execute function public.set_updated_at();

comment on table public.module_purchase_intents is
  'PLATFORM_BILLING module purchase intents. Entitlement grows only after verified payment. selectPlan mock is not the paid path.';

alter table public.module_purchase_intents enable row level security;
alter table public.module_purchase_intents force row level security;

create policy module_purchase_intents_org_member
  on public.module_purchase_intents for select to authenticated
  using (organization_id in (select public.organizations_for_current_auth_user()));
