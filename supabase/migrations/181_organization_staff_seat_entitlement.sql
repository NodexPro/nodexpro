-- Stage 2 — Organization-wide paid staff seat entitlement (Billing / module commerce).
-- Additive. DO NOT RUN until release approval.
-- Canonical membership remains organization_memberships; seats are commercial entitlement only.
--
-- Effective entitlement = included + grandfathered + purchased.
-- grandfathered_staff_seats = one-time migration compatibility capacity (NOT payment).

-- ========== PLATFORM SEAT PRICE / DEFAULTS (Billing-owned catalog) ==========
create table if not exists public.platform_staff_seat_pricing (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default 'default',
  currency char(3) not null default 'ILS',
  unit_price_amount numeric(12,2) not null,
  billing_period text not null default 'month' check (billing_period in ('month', 'year')),
  default_included_staff_seats int not null default 0 check (default_included_staff_seats >= 0),
  trial_included_staff_seats int not null default 1 check (trial_included_staff_seats >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger platform_staff_seat_pricing_updated_at
  before update on public.platform_staff_seat_pricing
  for each row execute function public.set_updated_at();

insert into public.platform_staff_seat_pricing (
  code, currency, unit_price_amount, billing_period,
  default_included_staff_seats, trial_included_staff_seats, is_active
)
values ('default', 'ILS', 49.00, 'month', 0, 1, true)
on conflict (code) do nothing;

-- ========== ORG PURCHASED + GRANDFATHERED SEATS ==========
create table if not exists public.organization_staff_seat_entitlements (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  purchased_additional_staff_seats int not null default 0
    check (purchased_additional_staff_seats >= 0),
  -- One-time legacy compatibility capacity at seat-system entry. NOT purchased. NOT billable.
  grandfathered_staff_seats int not null default 0
    check (grandfathered_staff_seats >= 0),
  -- Optional Billing override for plan-included seats (null = resolve from catalog/plan limits).
  included_staff_seats_override int null
    check (included_staff_seats_override is null or included_staff_seats_override >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organization_staff_seat_entitlements_updated_at
  before update on public.organization_staff_seat_entitlements
  for each row execute function public.set_updated_at();

alter table public.platform_staff_seat_pricing enable row level security;
alter table public.organization_staff_seat_entitlements enable row level security;
alter table public.platform_staff_seat_pricing force row level security;
alter table public.organization_staff_seat_entitlements force row level security;
revoke all on table public.platform_staff_seat_pricing from anon, authenticated;
revoke all on table public.organization_staff_seat_entitlements from anon, authenticated;

-- Future-ready plan-included seats (V1 product: 0 included staff on CO standard).
insert into public.module_plan_limits (module_plan_id, limit_code, limit_value, is_unlimited)
select mp.id, 'included_staff_seats', 0, false
from public.module_plans mp
join public.modules m on m.id = mp.module_id
where m.code = 'client-operations' and mp.code = 'standard'
on conflict (module_plan_id, limit_code) do nothing;

-- ========== HELPERS ==========
create or replace function public.staff_seat_role_consumes(p_role_code text)
returns boolean
language sql
immutable
as $$
  select p_role_code in ('admin', 'staff');
$$;

create or replace function public.resolve_org_included_staff_seats(p_organization_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_override int;
  v_default int := 0;
  v_trial_included int := 1;
  v_plan_included numeric := 0;
  v_on_trial boolean := false;
begin
  select e.included_staff_seats_override
    into v_override
  from public.organization_staff_seat_entitlements e
  where e.organization_id = p_organization_id;

  if v_override is not null then
    return v_override;
  end if;

  select coalesce(p.default_included_staff_seats, 0), coalesce(p.trial_included_staff_seats, 1)
    into v_default, v_trial_included
  from public.platform_staff_seat_pricing p
  where p.code = 'default' and p.is_active = true
  limit 1;

  select exists (
    select 1
    from public.organization_trials t
    where t.organization_id = p_organization_id
      and t.trial_scope = 'full_platform'
      and t.status = 'trialing'
      and (t.ends_at is null or t.ends_at > now())
  ) into v_on_trial;

  select coalesce(max(l.limit_value), 0)
    into v_plan_included
  from public.organization_module_subscriptions s
  join public.module_plan_limits l
    on l.module_plan_id = s.module_plan_id
   and l.limit_code = 'included_staff_seats'
   and l.is_unlimited = false
  where s.organization_id = p_organization_id
    and s.status in ('active', 'trialing');

  if v_on_trial then
    return greatest(v_trial_included, coalesce(v_plan_included, 0)::int);
  end if;

  return greatest(v_default, coalesce(v_plan_included, 0)::int);
end;
$$;

create or replace function public.count_active_staff_seat_consumers(p_organization_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.organization_memberships m
  where m.organization_id = p_organization_id
    and m.status = 'active'
    and public.staff_seat_role_consumes(m.role_code);
$$;

-- ========== ONE-TIME GRANDFATHER BACKFILL (migration entry only) ==========
-- Ensure every existing org has an entitlement row, then set the MINIMUM
-- grandfathered capacity so effective entitlement covers existing consumers.
-- Runtime paths must NEVER auto-increase grandfathered_staff_seats.

insert into public.organization_staff_seat_entitlements (
  organization_id,
  purchased_additional_staff_seats,
  grandfathered_staff_seats
)
select o.id, 0, 0
from public.organizations o
on conflict (organization_id) do nothing;

update public.organization_staff_seat_entitlements e
set
  grandfathered_staff_seats = greatest(
    0,
    public.count_active_staff_seat_consumers(e.organization_id)
      - public.resolve_org_included_staff_seats(e.organization_id)
      - coalesce(e.purchased_additional_staff_seats, 0)
  ),
  updated_at = now();

-- Concurrent-safe membership activation (accept invite / reactivate).
create or replace function public.activate_organization_membership_with_staff_seat_guard(
  p_organization_id uuid,
  p_user_id uuid,
  p_role_code text,
  p_invited_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_membership_id uuid;
  v_existing_status text;
  v_existing_role text;
  v_already_consuming boolean := false;
  v_consumes boolean;
  v_purchased int := 0;
  v_grandfathered int := 0;
  v_included int := 0;
  v_entitled int := 0;
  v_consumed int := 0;
begin
  if p_organization_id is null or p_user_id is null then
    raise exception 'STAFF_SEAT_ARGS_REQUIRED' using errcode = 'P0001';
  end if;
  if p_role_code is null or p_role_code not in ('owner', 'admin', 'staff', 'viewer') then
    raise exception 'STAFF_SEAT_INVALID_ROLE' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('staff_seats:' || p_organization_id::text, 0)
  );

  -- New orgs after migration: create row with grandfathered=0 (never auto-grow).
  insert into public.organization_staff_seat_entitlements (
    organization_id, purchased_additional_staff_seats, grandfathered_staff_seats
  )
  values (p_organization_id, 0, 0)
  on conflict (organization_id) do nothing;

  select e.purchased_additional_staff_seats, e.grandfathered_staff_seats
    into v_purchased, v_grandfathered
  from public.organization_staff_seat_entitlements e
  where e.organization_id = p_organization_id
  for update;

  v_included := public.resolve_org_included_staff_seats(p_organization_id);
  v_entitled := v_included + coalesce(v_purchased, 0) + coalesce(v_grandfathered, 0);
  v_consumes := public.staff_seat_role_consumes(p_role_code);

  select m.id, m.status, m.role_code
    into v_membership_id, v_existing_status, v_existing_role
  from public.organization_memberships m
  where m.organization_id = p_organization_id
    and m.user_id = p_user_id
  for update;

  if v_membership_id is not null
     and v_existing_status = 'active'
     and public.staff_seat_role_consumes(v_existing_role) then
    v_already_consuming := true;
  end if;

  if v_membership_id is not null and v_existing_status = 'active' then
    raise exception 'STAFF_SEAT_ALREADY_ACTIVE_MEMBER' using errcode = 'P0001';
  end if;

  v_consumed := public.count_active_staff_seat_consumers(p_organization_id);

  if v_consumes and not v_already_consuming and v_consumed >= v_entitled then
    raise exception 'STAFF_SEAT_CAPACITY_EXCEEDED'
      using errcode = 'P0001',
            detail = format('consumed=%s entitled=%s', v_consumed, v_entitled);
  end if;

  if v_membership_id is null then
    insert into public.organization_memberships (
      organization_id, user_id, role_code, status,
      invited_by, joined_at, created_at, updated_at
    ) values (
      p_organization_id, p_user_id, p_role_code, 'active',
      p_invited_by, v_now, v_now, v_now
    )
    returning id into v_membership_id;
  else
    update public.organization_memberships
    set role_code = p_role_code,
        status = 'active',
        invited_by = coalesce(p_invited_by, invited_by),
        joined_at = v_now,
        revoked_at = null,
        updated_at = v_now
    where id = v_membership_id
    returning id into v_membership_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'membership_id', v_membership_id,
    'included_staff_seats', v_included,
    'grandfathered_staff_seats', coalesce(v_grandfathered, 0),
    'purchased_staff_seats', coalesce(v_purchased, 0),
    'entitled_staff_seats', v_entitled,
    'active_consumed_staff_seats', public.count_active_staff_seat_consumers(p_organization_id)
  );
end;
$$;

-- Concurrent-safe role change when increasing seat consumption.
create or replace function public.change_organization_membership_role_with_staff_seat_guard(
  p_organization_id uuid,
  p_membership_id uuid,
  p_new_role_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_old_role text;
  v_status text;
  v_purchased int := 0;
  v_grandfathered int := 0;
  v_included int := 0;
  v_entitled int := 0;
  v_consumed int := 0;
  v_was_consuming boolean;
  v_will_consume boolean;
begin
  if p_new_role_code is null or p_new_role_code not in ('admin', 'staff', 'viewer') then
    raise exception 'STAFF_SEAT_INVALID_ROLE' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('staff_seats:' || p_organization_id::text, 0)
  );

  insert into public.organization_staff_seat_entitlements (
    organization_id, purchased_additional_staff_seats, grandfathered_staff_seats
  )
  values (p_organization_id, 0, 0)
  on conflict (organization_id) do nothing;

  select e.purchased_additional_staff_seats, e.grandfathered_staff_seats
    into v_purchased, v_grandfathered
  from public.organization_staff_seat_entitlements e
  where e.organization_id = p_organization_id
  for update;

  select m.user_id, m.role_code, m.status
    into v_user_id, v_old_role, v_status
  from public.organization_memberships m
  where m.id = p_membership_id
    and m.organization_id = p_organization_id
  for update;

  if v_user_id is null then
    raise exception 'STAFF_SEAT_MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_old_role = 'owner' then
    raise exception 'STAFF_SEAT_CANNOT_MODIFY_OWNER' using errcode = 'P0001';
  end if;
  if v_status <> 'active' then
    raise exception 'STAFF_SEAT_MEMBER_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  v_was_consuming := public.staff_seat_role_consumes(v_old_role);
  v_will_consume := public.staff_seat_role_consumes(p_new_role_code);
  v_included := public.resolve_org_included_staff_seats(p_organization_id);
  v_entitled := v_included + coalesce(v_purchased, 0) + coalesce(v_grandfathered, 0);
  v_consumed := public.count_active_staff_seat_consumers(p_organization_id);

  if v_will_consume and not v_was_consuming and v_consumed >= v_entitled then
    raise exception 'STAFF_SEAT_CAPACITY_EXCEEDED'
      using errcode = 'P0001',
            detail = format('consumed=%s entitled=%s', v_consumed, v_entitled);
  end if;

  update public.organization_memberships
  set role_code = p_new_role_code,
      updated_at = now()
  where id = p_membership_id
    and organization_id = p_organization_id;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_user_id,
    'from_role', v_old_role,
    'to_role', p_new_role_code,
    'included_staff_seats', v_included,
    'grandfathered_staff_seats', coalesce(v_grandfathered, 0),
    'purchased_staff_seats', coalesce(v_purchased, 0),
    'entitled_staff_seats', v_entitled,
    'active_consumed_staff_seats', public.count_active_staff_seat_consumers(p_organization_id)
  );
end;
$$;

-- Concurrent-safe purchased seat quantity update (Platform Owner).
-- Updates PURCHASED only — never mutates grandfathered_staff_seats.
create or replace function public.set_organization_purchased_staff_seats(
  p_organization_id uuid,
  p_purchased_additional_staff_seats int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_included int := 0;
  v_grandfathered int := 0;
  v_entitled int := 0;
  v_consumed int := 0;
  v_prev int := 0;
begin
  if p_organization_id is null then
    raise exception 'STAFF_SEAT_ARGS_REQUIRED' using errcode = 'P0001';
  end if;
  if p_purchased_additional_staff_seats is null or p_purchased_additional_staff_seats < 0 then
    raise exception 'STAFF_SEAT_INVALID_QUANTITY' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('staff_seats:' || p_organization_id::text, 0)
  );

  insert into public.organization_staff_seat_entitlements (
    organization_id, purchased_additional_staff_seats, grandfathered_staff_seats
  )
  values (p_organization_id, 0, 0)
  on conflict (organization_id) do nothing;

  select e.purchased_additional_staff_seats, e.grandfathered_staff_seats
    into v_prev, v_grandfathered
  from public.organization_staff_seat_entitlements e
  where e.organization_id = p_organization_id
  for update;

  v_included := public.resolve_org_included_staff_seats(p_organization_id);
  v_entitled := v_included + p_purchased_additional_staff_seats + coalesce(v_grandfathered, 0);
  v_consumed := public.count_active_staff_seat_consumers(p_organization_id);

  if v_consumed > v_entitled then
    raise exception 'STAFF_SEAT_REDUCTION_BLOCKED_BY_CONSUMPTION'
      using errcode = 'P0001',
            detail = format('consumed=%s entitled=%s', v_consumed, v_entitled);
  end if;

  update public.organization_staff_seat_entitlements
  set purchased_additional_staff_seats = p_purchased_additional_staff_seats,
      updated_at = now()
  where organization_id = p_organization_id;
  -- grandfathered_staff_seats intentionally unchanged

  return jsonb_build_object(
    'ok', true,
    'previous_purchased_staff_seats', coalesce(v_prev, 0),
    'purchased_staff_seats', p_purchased_additional_staff_seats,
    'included_staff_seats', v_included,
    'grandfathered_staff_seats', coalesce(v_grandfathered, 0),
    'entitled_staff_seats', v_entitled,
    'active_consumed_staff_seats', v_consumed,
    'available_staff_seats', greatest(v_entitled - v_consumed, 0)
  );
end;
$$;

revoke all on function public.activate_organization_membership_with_staff_seat_guard(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.change_organization_membership_role_with_staff_seat_guard(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.set_organization_purchased_staff_seats(uuid, int) from public, anon, authenticated;
grant execute on function public.activate_organization_membership_with_staff_seat_guard(uuid, uuid, text, uuid) to service_role;
grant execute on function public.change_organization_membership_role_with_staff_seat_guard(uuid, uuid, text) to service_role;
grant execute on function public.set_organization_purchased_staff_seats(uuid, int) to service_role;

comment on table public.platform_staff_seat_pricing is
  'Billing-owned staff seat unit price and default/trial included seat allowances. Organization-wide (not per-module).';
comment on table public.organization_staff_seat_entitlements is
  'Billing-owned staff seats per org. Effective entitlement = included + grandfathered + purchased. Grandfathered is one-time legacy compatibility, not payment.';
comment on column public.organization_staff_seat_entitlements.grandfathered_staff_seats is
  'One-time migration compatibility capacity covering existing active admin/staff at seat-system entry. Not purchased. Not billable. Never auto-increased at runtime.';
