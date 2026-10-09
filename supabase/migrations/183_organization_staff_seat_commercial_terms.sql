-- Staff-seat commercial terms. Purchased quantity is the version covering current_date.
-- No payment, invoice, or scheduler. Closed history is not rewritten.
--
-- LEGACY COMPATIBILITY MIRROR
-- organization_staff_seat_entitlements.purchased_additional_staff_seats stays.
-- It is not canonical. It exists only so the pre-183 API can keep reading and
-- calling the same RPC while this migration is applied with that API still live.
-- Canonical purchased quantity is organization_staff_seat_commercial_terms.
-- A later, separately approved migration may drop the mirror. This file does not.

create extension if not exists btree_gist;

create table if not exists public.organization_staff_seat_commercial_terms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  effective_from date not null,
  effective_to date null,
  additional_seat_quantity int not null check (additional_seat_quantity >= 0),
  currency char(3) null,
  unit_price_amount numeric(12,2) null check (unit_price_amount is null or unit_price_amount >= 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent >= 0 and discount_percent <= 100),
  billing_period text not null check (billing_period in ('month', 'year')),
  created_by_user_id uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint organization_staff_seat_commercial_terms_window_ok
    check (effective_to is null or effective_to >= effective_from),
  constraint organization_staff_seat_commercial_terms_price_currency
    check (
      (unit_price_amount is null and currency is null)
      or (unit_price_amount is not null and currency is not null)
    ),
  constraint organization_staff_seat_commercial_terms_no_overlap
    exclude using gist (
      organization_id with =,
      daterange(effective_from, effective_to, '[]') with &&
    )
);

create index if not exists idx_staff_seat_terms_org_from
  on public.organization_staff_seat_commercial_terms (organization_id, effective_from);

alter table public.organization_staff_seat_commercial_terms enable row level security;
alter table public.organization_staff_seat_commercial_terms force row level security;
revoke all on table public.organization_staff_seat_commercial_terms from anon, authenticated;

comment on table public.organization_staff_seat_commercial_terms is
  'Canonical organization staff-seat commercial terms by effective date. Purchased quantity is resolved from the version covering the date. Not a payment record. NULL unit price means no agreed charge. The entitlements.purchased_additional_staff_seats column is a legacy compatibility mirror, not a second truth.';

-- Backfill agreed quantity only. Do not copy the technical catalog unit price.
insert into public.organization_staff_seat_commercial_terms (
  organization_id,
  effective_from,
  effective_to,
  additional_seat_quantity,
  currency,
  unit_price_amount,
  discount_percent,
  billing_period,
  created_by_user_id
)
select
  e.organization_id,
  current_date,
  null,
  e.purchased_additional_staff_seats,
  null,
  null,
  0,
  coalesce(
    (
      select p.billing_period
      from public.platform_staff_seat_pricing p
      where p.code = 'default' and p.is_active = true
      order by p.created_at
      limit 1
    ),
    'month'
  ),
  null
from public.organization_staff_seat_entitlements e
where e.purchased_additional_staff_seats > 0;

-- Operational purchased quantity for a date. Unsafe reductions stay non-operational.
create or replace function public.resolve_org_purchased_staff_seats(
  p_organization_id uuid,
  p_as_of date default current_date
)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_covering_qty int;
  v_covering_from date;
  v_included int := 0;
  v_grandfathered int := 0;
  v_consumed int := 0;
  v_qty int;
  v_from date;
begin
  if p_organization_id is null or p_as_of is null then
    return 0;
  end if;

  select t.additional_seat_quantity, t.effective_from
    into v_covering_qty, v_covering_from
  from public.organization_staff_seat_commercial_terms t
  where t.organization_id = p_organization_id
    and t.effective_from <= p_as_of
    and (t.effective_to is null or t.effective_to >= p_as_of)
  order by t.effective_from desc
  limit 1;

  if v_covering_from is null then
    return 0;
  end if;

  v_included := public.resolve_org_included_staff_seats(p_organization_id);
  select coalesce(e.grandfathered_staff_seats, 0)
    into v_grandfathered
  from public.organization_staff_seat_entitlements e
  where e.organization_id = p_organization_id;
  v_grandfathered := coalesce(v_grandfathered, 0);
  v_consumed := public.count_active_staff_seat_consumers(p_organization_id);

  if v_included + v_grandfathered + v_covering_qty >= v_consumed then
    return v_covering_qty;
  end if;

  for v_qty, v_from in
    select t.additional_seat_quantity, t.effective_from
    from public.organization_staff_seat_commercial_terms t
    where t.organization_id = p_organization_id
      and t.effective_from < v_covering_from
    order by t.effective_from desc
  loop
    if v_included + v_grandfathered + v_qty >= v_consumed then
      return v_qty;
    end if;
  end loop;

  return 0;
end;
$$;

create or replace function public.staff_seat_catalog_billing_period()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.billing_period
      from public.platform_staff_seat_pricing p
      where p.code = 'default' and p.is_active = true
      order by p.created_at
      limit 1
    ),
    'month'
  );
$$;

-- Writes one terms version. Closes the previous open window. Does not rewrite closed history.
create or replace function public.apply_organization_staff_seat_commercial_terms(
  p_organization_id uuid,
  p_effective_from date,
  p_additional_seat_quantity int,
  p_unit_price_amount numeric,
  p_currency text,
  p_discount_percent numeric,
  p_preserve_commercial_price boolean,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_currency char(3);
  v_price numeric(12,2);
  v_discount numeric(5,2);
  v_period text;
  v_included int := 0;
  v_grandfathered int := 0;
  v_consumed int := 0;
  v_existing_to date;
  v_next date;
  v_prev_qty int;
  v_prev_price numeric;
  v_prev_discount numeric;
  v_prev_currency char(3);
  v_prev_from date;
begin
  if p_organization_id is null or p_effective_from is null then
    raise exception 'STAFF_SEAT_ARGS_REQUIRED' using errcode = 'P0001';
  end if;
  if p_additional_seat_quantity is null or p_additional_seat_quantity < 0 then
    raise exception 'STAFF_SEAT_INVALID_QUANTITY' using errcode = 'P0001';
  end if;
  if p_effective_from < current_date then
    raise exception 'STAFF_SEAT_TERMS_HISTORY_IMMUTABLE' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('staff_seats:' || p_organization_id::text, 0));

  insert into public.organization_staff_seat_entitlements (organization_id, grandfathered_staff_seats)
  values (p_organization_id, 0)
  on conflict (organization_id) do nothing;

  if p_effective_from <= current_date then
    v_included := public.resolve_org_included_staff_seats(p_organization_id);
    select coalesce(e.grandfathered_staff_seats, 0)
      into v_grandfathered
    from public.organization_staff_seat_entitlements e
    where e.organization_id = p_organization_id
    for update;
    v_grandfathered := coalesce(v_grandfathered, 0);
    v_consumed := public.count_active_staff_seat_consumers(p_organization_id);
    if v_consumed > v_included + v_grandfathered + p_additional_seat_quantity then
      raise exception 'STAFF_SEAT_REDUCTION_BLOCKED_BY_CONSUMPTION'
        using errcode = 'P0001',
              detail = format('consumed=%s entitled=%s', v_consumed, v_included + v_grandfathered + p_additional_seat_quantity);
    end if;
  end if;

  select t.additional_seat_quantity, t.unit_price_amount, t.discount_percent, t.currency, t.effective_from
    into v_prev_qty, v_prev_price, v_prev_discount, v_prev_currency, v_prev_from
  from public.organization_staff_seat_commercial_terms t
  where t.organization_id = p_organization_id
    and t.effective_from <= current_date
    and (t.effective_to is null or t.effective_to >= current_date)
  order by t.effective_from desc
  limit 1;

  if coalesce(p_preserve_commercial_price, false) then
    if v_prev_from is null then
      v_price := null;
      v_currency := null;
      v_discount := 0;
      v_period := public.staff_seat_catalog_billing_period();
    else
      v_price := v_prev_price;
      v_currency := v_prev_currency;
      v_discount := coalesce(v_prev_discount, 0);
      select t.billing_period into v_period
      from public.organization_staff_seat_commercial_terms t
      where t.organization_id = p_organization_id
        and t.effective_from = v_prev_from;
    end if;
  else
    v_discount := coalesce(p_discount_percent, 0);
    if v_discount < 0 or v_discount > 100 then
      raise exception 'STAFF_SEAT_INVALID_DISCOUNT' using errcode = 'P0001';
    end if;
    if p_unit_price_amount is null then
      v_price := null;
      v_currency := null;
    else
      if p_unit_price_amount < 0 then
        raise exception 'STAFF_SEAT_INVALID_PRICE' using errcode = 'P0001';
      end if;
      if p_currency is null or p_currency !~ '^[A-Za-z]{3}$' then
        raise exception 'STAFF_SEAT_INVALID_CURRENCY' using errcode = 'P0001';
      end if;
      v_price := round(p_unit_price_amount, 2);
      v_currency := upper(p_currency);
    end if;
    v_period := public.staff_seat_catalog_billing_period();
  end if;

  -- Close only the still-open window that overlaps the new start. Do not change its price or quantity.
  update public.organization_staff_seat_commercial_terms t
  set effective_to = p_effective_from - 1
  where t.organization_id = p_organization_id
    and t.effective_from < p_effective_from
    and (t.effective_to is null or t.effective_to >= p_effective_from);

  select t.effective_to
    into v_existing_to
  from public.organization_staff_seat_commercial_terms t
  where t.organization_id = p_organization_id
    and t.effective_from = p_effective_from;

  if found then
    update public.organization_staff_seat_commercial_terms t
    set additional_seat_quantity = p_additional_seat_quantity,
        currency = v_currency,
        unit_price_amount = v_price,
        discount_percent = v_discount,
        billing_period = v_period,
        created_by_user_id = coalesce(p_created_by, t.created_by_user_id)
    where t.organization_id = p_organization_id
      and t.effective_from = p_effective_from;
  else
    insert into public.organization_staff_seat_commercial_terms (
      organization_id, effective_from, effective_to, additional_seat_quantity,
      currency, unit_price_amount, discount_percent, billing_period, created_by_user_id
    ) values (
      p_organization_id, p_effective_from, null, p_additional_seat_quantity,
      v_currency, v_price, v_discount, v_period, p_created_by
    );
  end if;

  select min(t.effective_from)
    into v_next
  from public.organization_staff_seat_commercial_terms t
  where t.organization_id = p_organization_id
    and t.effective_from > p_effective_from;

  if v_next is not null then
    update public.organization_staff_seat_commercial_terms t
    set effective_to = v_next - 1
    where t.organization_id = p_organization_id
      and t.effective_from = p_effective_from
      and (t.effective_to is null or t.effective_to >= v_next);
  end if;

  -- Same transaction as the terms write. Future-dated versions do not move the mirror:
  -- there is no scheduler, and the pre-183 API does not write future terms.
  -- A current-date write stores the operational quantity, which the reduction guard
  -- has already proven safe, so this matches the quantity just written.
  if p_effective_from <= current_date then
    update public.organization_staff_seat_entitlements e
    set purchased_additional_staff_seats = public.resolve_org_purchased_staff_seats(p_organization_id, current_date),
        updated_at = now()
    where e.organization_id = p_organization_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'organization_id', p_organization_id,
    'effective_from', p_effective_from,
    'additional_seat_quantity', p_additional_seat_quantity,
    'unit_price_amount', v_price,
    'currency', v_currency,
    'discount_percent', v_discount,
    'billing_period', v_period,
    'previous_additional_seat_quantity', v_prev_qty,
    'previous_unit_price_amount', v_prev_price,
    'previous_discount_percent', v_prev_discount,
    'previous_currency', v_prev_currency,
    'purchased_staff_seats', public.resolve_org_purchased_staff_seats(p_organization_id, current_date)
  );
end;
$$;

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

  perform pg_advisory_xact_lock(hashtextextended('staff_seats:' || p_organization_id::text, 0));

  insert into public.organization_staff_seat_entitlements (organization_id, grandfathered_staff_seats)
  values (p_organization_id, 0)
  on conflict (organization_id) do nothing;

  select e.grandfathered_staff_seats
    into v_grandfathered
  from public.organization_staff_seat_entitlements e
  where e.organization_id = p_organization_id
  for update;

  v_purchased := public.resolve_org_purchased_staff_seats(p_organization_id);
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

  perform pg_advisory_xact_lock(hashtextextended('staff_seats:' || p_organization_id::text, 0));

  insert into public.organization_staff_seat_entitlements (organization_id, grandfathered_staff_seats)
  values (p_organization_id, 0)
  on conflict (organization_id) do nothing;

  select e.grandfathered_staff_seats
    into v_grandfathered
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
  v_purchased := public.resolve_org_purchased_staff_seats(p_organization_id);
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

-- Same (uuid, int) signature the pre-183 API calls. Body now writes canonical terms
-- for today and synchronizes the legacy mirror inside that same function.
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
  v_result jsonb;
  v_purchased int := 0;
  v_included int := 0;
  v_grandfathered int := 0;
  v_consumed int := 0;
  v_entitled int := 0;
begin
  v_result := public.apply_organization_staff_seat_commercial_terms(
    p_organization_id,
    current_date,
    p_purchased_additional_staff_seats,
    null,
    null,
    null,
    true,
    null
  );
  v_purchased := public.resolve_org_purchased_staff_seats(p_organization_id, current_date);
  v_included := public.resolve_org_included_staff_seats(p_organization_id);
  select coalesce(e.grandfathered_staff_seats, 0)
    into v_grandfathered
  from public.organization_staff_seat_entitlements e
  where e.organization_id = p_organization_id;
  v_grandfathered := coalesce(v_grandfathered, 0);
  v_consumed := public.count_active_staff_seat_consumers(p_organization_id);
  v_entitled := v_included + v_purchased + v_grandfathered;
  return v_result || jsonb_build_object(
    'previous_purchased_staff_seats', coalesce((v_result ->> 'previous_additional_seat_quantity')::int, 0),
    'purchased_staff_seats', v_purchased,
    'included_staff_seats', v_included,
    'grandfathered_staff_seats', v_grandfathered,
    'entitled_staff_seats', v_entitled,
    'active_consumed_staff_seats', v_consumed,
    'available_staff_seats', greatest(v_entitled - v_consumed, 0),
    'price_preserved', true
  );
end;
$$;

comment on column public.organization_staff_seat_entitlements.purchased_additional_staff_seats is
  'LEGACY COMPATIBILITY MIRROR. Not canonical. Mirrors the current-date operational purchased quantity for the pre-183 API. Canonical truth is organization_staff_seat_commercial_terms.';

comment on table public.organization_staff_seat_entitlements is
  'Staff-seat entitlement: grandfathered seats, included override, and the legacy purchased_additional_staff_seats compatibility mirror. Canonical purchased quantity lives in organization_staff_seat_commercial_terms.';

-- Catch a quantity write that committed on the old function while this migration was running.
insert into public.organization_staff_seat_commercial_terms (
  organization_id,
  effective_from,
  effective_to,
  additional_seat_quantity,
  currency,
  unit_price_amount,
  discount_percent,
  billing_period,
  created_by_user_id
)
select
  e.organization_id,
  current_date,
  null,
  e.purchased_additional_staff_seats,
  null,
  null,
  0,
  coalesce(
    (
      select p.billing_period
      from public.platform_staff_seat_pricing p
      where p.code = 'default' and p.is_active = true
      order by p.created_at
      limit 1
    ),
    'month'
  ),
  null
from public.organization_staff_seat_entitlements e
where e.purchased_additional_staff_seats > 0
  and not exists (
    select 1
    from public.organization_staff_seat_commercial_terms t
    where t.organization_id = e.organization_id
      and t.effective_from <= current_date
      and (t.effective_to is null or t.effective_to >= current_date)
  );

update public.organization_staff_seat_commercial_terms t
set additional_seat_quantity = e.purchased_additional_staff_seats
from public.organization_staff_seat_entitlements e
where t.organization_id = e.organization_id
  and t.effective_from = current_date
  and t.effective_to is null
  and t.unit_price_amount is null
  and t.currency is null
  and t.additional_seat_quantity <> e.purchased_additional_staff_seats;

revoke all on function public.resolve_org_purchased_staff_seats(uuid, date) from public, anon, authenticated;
revoke all on function public.staff_seat_catalog_billing_period() from public, anon, authenticated;
revoke all on function public.apply_organization_staff_seat_commercial_terms(uuid, date, int, numeric, text, numeric, boolean, uuid) from public, anon, authenticated;
revoke all on function public.activate_organization_membership_with_staff_seat_guard(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.change_organization_membership_role_with_staff_seat_guard(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.set_organization_purchased_staff_seats(uuid, int) from public, anon, authenticated;

grant execute on function public.resolve_org_purchased_staff_seats(uuid, date) to service_role;
grant execute on function public.staff_seat_catalog_billing_period() to service_role;
grant execute on function public.apply_organization_staff_seat_commercial_terms(uuid, date, int, numeric, text, numeric, boolean, uuid) to service_role;
grant execute on function public.activate_organization_membership_with_staff_seat_guard(uuid, uuid, text, uuid) to service_role;
grant execute on function public.change_organization_membership_role_with_staff_seat_guard(uuid, uuid, text) to service_role;
grant execute on function public.set_organization_purchased_staff_seats(uuid, int) to service_role;
