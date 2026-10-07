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
    seats_recurring_total_amount: seats,
    commercial_recurring_total_amount: modules + seats,
    commercial_currency: params.currency,
  };
}
