/**
 * Pure staff-seat commercial rules (Billing).
 * Seat consumers are organization-scoped roles with operational workspace access.
 * Effective entitlement = included + grandfathered + purchased.
 */

export const STAFF_SEAT_CONSUMING_ROLES = ['admin', 'staff'] as const;
export type StaffSeatConsumingRole = (typeof STAFF_SEAT_CONSUMING_ROLES)[number];

export function roleConsumesStaffSeat(roleCode: string | null | undefined): boolean {
  const code = String(roleCode ?? '').trim().toLowerCase();
  return (STAFF_SEAT_CONSUMING_ROLES as readonly string[]).includes(code);
}

export type StaffSeatEntitlementTruth = {
  included_staff_seats: number;
  grandfathered_staff_seats: number;
  purchased_staff_seats: number;
  entitled_staff_seats: number;
  active_consumed_staff_seats: number;
  available_staff_seats: number;
  seat_unit_price_amount: number;
  seat_currency: string;
  seat_billing_period: string;
  modules_recurring_total_amount: number;
  seats_recurring_total_amount: number;
  commercial_recurring_total_amount: number;
  commercial_currency: string;
  trial_staff_seat_policy: 'finite_trial_allowance';
  on_full_platform_trial: boolean;
  seat_charge_label?: string;
};

/** One-time migration compatibility amount — never auto-grown at runtime. */
export function computeGrandfatheredStaffSeats(params: {
  existing_consumption: number;
  included_staff_seats: number;
  purchased_staff_seats: number;
}): number {
  const consumption = Math.max(0, Math.floor(params.existing_consumption));
  const included = Math.max(0, Math.floor(params.included_staff_seats));
  const purchased = Math.max(0, Math.floor(params.purchased_staff_seats));
  return Math.max(0, consumption - included - purchased);
}

export function computeStaffSeatAvailability(params: {
  included_staff_seats: number;
  grandfathered_staff_seats?: number;
  purchased_staff_seats: number;
  active_consumed_staff_seats: number;
}): Pick<
  StaffSeatEntitlementTruth,
  | 'included_staff_seats'
  | 'grandfathered_staff_seats'
  | 'purchased_staff_seats'
  | 'entitled_staff_seats'
  | 'active_consumed_staff_seats'
  | 'available_staff_seats'
> {
  const included = Math.max(0, Math.floor(params.included_staff_seats));
  const grandfathered = Math.max(0, Math.floor(params.grandfathered_staff_seats ?? 0));
  const purchased = Math.max(0, Math.floor(params.purchased_staff_seats));
  const consumed = Math.max(0, Math.floor(params.active_consumed_staff_seats));
  const entitled = included + grandfathered + purchased;
  return {
    included_staff_seats: included,
    grandfathered_staff_seats: grandfathered,
    purchased_staff_seats: purchased,
    entitled_staff_seats: entitled,
    active_consumed_staff_seats: consumed,
    available_staff_seats: Math.max(entitled - consumed, 0),
  };
}

export function computeCommercialRecurringTotals(params: {
  modules_recurring_total_amount: number;
  purchased_staff_seats: number;
  seat_unit_price_amount: number;
  currency: string;
}): {
  modules_recurring_total_amount: number;
  seats_recurring_total_amount: number;
  commercial_recurring_total_amount: number;
  commercial_currency: string;
} {
  const modules = Number(params.modules_recurring_total_amount) || 0;
  // Grandfathered is never billable — only purchased seats recur.
  const seats =
    Math.max(0, Math.floor(params.purchased_staff_seats)) * (Number(params.seat_unit_price_amount) || 0);
  return {
    modules_recurring_total_amount: modules,
    seats_recurring_total_amount: roundStaffSeatMoney(seats),
    commercial_recurring_total_amount: roundStaffSeatMoney(modules + seats),
    commercial_currency: params.currency,
  };
}

/** Half-up to cents. Organization seat charges use this; catalog seed price is not a fallback. */
export function roundStaffSeatMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export type StaffSeatTermVersion = {
  effective_from: string;
  effective_to: string | null;
  additional_seat_quantity: number;
  currency: string | null;
  unit_price_amount: number | null;
  discount_percent: number;
  billing_period: string;
};

export type StaffSeatCommercialCharge = {
  effective_unit_price: number | null;
  recurring_seat_charge: number | null;
  seat_charge_label: string;
  effective_unit_price_label: string;
  billing_cadence: string;
  billing_cadence_label: string;
};

export type StaffSeatTermsView = {
  effective_from: string | null;
  effective_to: string | null;
  additional_seat_quantity: number;
  currency: string | null;
  unit_price: number | null;
  discount_percent: number;
  effective_unit_price: number | null;
  recurring_seat_charge: number | null;
  billing_cadence: string | null;
  seat_charge_label: string;
  effective_unit_price_label: string;
};

export type StaffSeatOrgProjection = {
  included_staff_seats: number;
  grandfathered_staff_seats: number;
  purchased_additional_staff_seats: number;
  entitled_staff_seats: number;
  used_staff_seats: number;
  available_staff_seats: number;
  staff_seats_label: string;
  seat_charge_label: string;
  current_terms: StaffSeatTermsView | null;
  scheduled_terms: StaffSeatTermsView | null;
  blocked_scheduled_reduction: {
    status_code: 'STAFF_SEAT_REDUCTION_BLOCKED_BY_CONSUMPTION';
    status_label: string;
    terms: StaffSeatTermsView;
  } | null;
};

const BLOCKED_REDUCTION_LABEL =
  'Current active Staff/Admin usage prevents this lower quantity from becoming operational.';

export function staffSeatQuantityIsSafe(params: {
  included_staff_seats: number;
  grandfathered_staff_seats: number;
  additional_seat_quantity: number;
  active_consumed_staff_seats: number;
}): boolean {
  const included = Math.max(0, Math.floor(params.included_staff_seats));
  const grandfathered = Math.max(0, Math.floor(params.grandfathered_staff_seats));
  const quantity = Math.max(0, Math.floor(params.additional_seat_quantity));
  const consumed = Math.max(0, Math.floor(params.active_consumed_staff_seats));
  return included + grandfathered + quantity >= consumed;
}

function cadenceLabel(period: string | null | undefined): string {
  return period === 'year' ? '/year' : '/month';
}

function moneyAmountLabel(amount: number, currency: string | null): string {
  const n = roundStaffSeatMoney(amount).toFixed(2);
  if ((currency ?? '').toUpperCase() === 'ILS') return `₪${n}`;
  return currency ? `${currency.toUpperCase()} ${n}` : n;
}

export function computeStaffSeatCommercialCharge(version: {
  additional_seat_quantity: number;
  unit_price_amount: number | null;
  discount_percent: number;
  currency: string | null;
  billing_period: string | null;
} | null): StaffSeatCommercialCharge {
  const period = version?.billing_period === 'year' ? 'year' : 'month';
  const cadence = cadenceLabel(period);
  if (!version || version.unit_price_amount == null) {
    return {
      effective_unit_price: null,
      recurring_seat_charge: null,
      seat_charge_label: '—',
      effective_unit_price_label: '—',
      billing_cadence: period,
      billing_cadence_label: cadence,
    };
  }
  const discount = Math.min(100, Math.max(0, Number(version.discount_percent) || 0));
  const unit = Math.max(0, Number(version.unit_price_amount));
  const qty = Math.max(0, Math.floor(version.additional_seat_quantity));
  const effectiveUnit = roundStaffSeatMoney(unit * (1 - discount / 100));
  const recurring = roundStaffSeatMoney(qty * effectiveUnit);
  const listRecurring = roundStaffSeatMoney(qty * unit);
  const seat_charge_label =
    discount > 0 && listRecurring !== recurring
      ? `${moneyAmountLabel(listRecurring, version.currency)} → ${moneyAmountLabel(recurring, version.currency)}${cadence}`
      : `${moneyAmountLabel(recurring, version.currency)}${cadence}`;
  return {
    effective_unit_price: effectiveUnit,
    recurring_seat_charge: recurring,
    seat_charge_label,
    effective_unit_price_label: moneyAmountLabel(effectiveUnit, version.currency),
    billing_cadence: period,
    billing_cadence_label: cadence,
  };
}

function toTermsView(version: StaffSeatTermVersion | null): StaffSeatTermsView | null {
  if (!version) return null;
  const charge = computeStaffSeatCommercialCharge(version);
  return {
    effective_from: version.effective_from,
    effective_to: version.effective_to,
    additional_seat_quantity: version.additional_seat_quantity,
    currency: version.currency,
    unit_price: version.unit_price_amount,
    discount_percent: version.discount_percent,
    effective_unit_price: charge.effective_unit_price,
    recurring_seat_charge: charge.recurring_seat_charge,
    billing_cadence: charge.billing_cadence,
    seat_charge_label: charge.seat_charge_label,
    effective_unit_price_label: charge.effective_unit_price_label,
  };
}

function coversDate(version: StaffSeatTermVersion, asOf: string): boolean {
  return version.effective_from <= asOf && (version.effective_to == null || version.effective_to >= asOf);
}

/**
 * Operational purchased quantity for asOf.
 * The covering version applies automatically when its date arrives.
 * An unsafe reduction does not become operational; the latest earlier safe quantity remains.
 */
export function resolveOperationalPurchasedStaffSeats(params: {
  as_of: string;
  versions: StaffSeatTermVersion[];
  included_staff_seats: number;
  grandfathered_staff_seats: number;
  active_consumed_staff_seats: number;
}): {
  purchased_staff_seats: number;
  covering: StaffSeatTermVersion | null;
  operational_version: StaffSeatTermVersion | null;
  blocked_version: StaffSeatTermVersion | null;
  scheduled_version: StaffSeatTermVersion | null;
} {
  const asOf = params.as_of;
  const versions = [...params.versions].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const covering =
    [...versions].reverse().find((version) => coversDate(version, asOf)) ?? null;
  const scheduled = versions.find((version) => version.effective_from > asOf) ?? null;
  const safety = {
    included_staff_seats: params.included_staff_seats,
    grandfathered_staff_seats: params.grandfathered_staff_seats,
    active_consumed_staff_seats: params.active_consumed_staff_seats,
  };
  if (!covering) {
    return {
      purchased_staff_seats: 0,
      covering: null,
      operational_version: null,
      blocked_version: null,
      scheduled_version: scheduled,
    };
  }
  if (staffSeatQuantityIsSafe({ ...safety, additional_seat_quantity: covering.additional_seat_quantity })) {
    return {
      purchased_staff_seats: covering.additional_seat_quantity,
      covering,
      operational_version: covering,
      blocked_version: null,
      scheduled_version: scheduled,
    };
  }
  const earlier = versions
    .filter((version) => version.effective_from < covering.effective_from)
    .reverse();
  const safeEarlier =
    earlier.find((version) =>
      staffSeatQuantityIsSafe({ ...safety, additional_seat_quantity: version.additional_seat_quantity }),
    ) ?? null;
  return {
    purchased_staff_seats: safeEarlier ? safeEarlier.additional_seat_quantity : 0,
    covering,
    operational_version: safeEarlier,
    blocked_version: covering,
    scheduled_version: scheduled,
  };
}

export function projectStaffSeatOrganization(params: {
  as_of: string;
  versions: StaffSeatTermVersion[];
  included_staff_seats: number;
  grandfathered_staff_seats: number;
  active_consumed_staff_seats: number;
}): StaffSeatOrgProjection {
  const resolved = resolveOperationalPurchasedStaffSeats(params);
  const seats = computeStaffSeatAvailability({
    included_staff_seats: params.included_staff_seats,
    grandfathered_staff_seats: params.grandfathered_staff_seats,
    purchased_staff_seats: resolved.purchased_staff_seats,
    active_consumed_staff_seats: params.active_consumed_staff_seats,
  });
  const current = toTermsView(resolved.operational_version);
  const blocked = toTermsView(resolved.blocked_version);
  const scheduled = toTermsView(resolved.scheduled_version);
  return {
    included_staff_seats: seats.included_staff_seats,
    grandfathered_staff_seats: seats.grandfathered_staff_seats,
    purchased_additional_staff_seats: seats.purchased_staff_seats,
    entitled_staff_seats: seats.entitled_staff_seats,
    used_staff_seats: seats.active_consumed_staff_seats,
    available_staff_seats: seats.available_staff_seats,
    staff_seats_label: `${seats.purchased_staff_seats} additional / ${seats.entitled_staff_seats} total`,
    seat_charge_label: current?.seat_charge_label ?? '—',
    current_terms: current,
    scheduled_terms: scheduled,
    blocked_scheduled_reduction: blocked
      ? {
          status_code: 'STAFF_SEAT_REDUCTION_BLOCKED_BY_CONSUMPTION',
          status_label: BLOCKED_REDUCTION_LABEL,
          terms: blocked,
        }
      : null,
  };
}
