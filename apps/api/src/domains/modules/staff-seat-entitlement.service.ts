/**
 * Canonical staff-seat entitlement (Billing / module commerce).
 * Organization-wide seats; module entitlement remains separate (requireModuleActive).
 */

import { supabaseAdmin } from '../../db/client.js';
import { AppError, badRequest, conflict, forbidden } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { hasValidTrial } from '../trial/trial.service.js';
import { resolveEntitlement } from './entitlement.service.js';
import {
  computeCommercialRecurringTotals,
  computeGrandfatheredStaffSeats,
  computeStaffSeatAvailability,
  roleConsumesStaffSeat,
  type StaffSeatEntitlementTruth,
} from './staff-seat-entitlement.pure.js';

export {
  roleConsumesStaffSeat,
  computeStaffSeatAvailability,
  computeCommercialRecurringTotals,
  computeGrandfatheredStaffSeats,
};
export type { StaffSeatEntitlementTruth };

const SEAT_CAPACITY_CODE = 'STAFF_SEAT_CAPACITY_EXCEEDED';
const SEAT_REDUCTION_CODE = 'STAFF_SEAT_REDUCTION_BLOCKED_BY_CONSUMPTION';

export async function assertModuleEntitled(
  organizationId: string,
  moduleCode: string,
): Promise<{ status: 'entitled' | 'trial' }> {
  const { data: mod } = await supabaseAdmin
    .from('modules')
    .select('id, is_active')
    .eq('code', moduleCode)
    .maybeSingle();
  if (!mod || !(mod as { is_active?: boolean }).is_active) {
    throw forbidden('Module not available', 'MODULE_NOT_ACTIVE');
  }
  const entitlement = await resolveEntitlement(organizationId, (mod as { id: string }).id);
  if (entitlement.status !== 'entitled' && entitlement.status !== 'trial') {
    throw forbidden(entitlement.reason ?? 'Module not entitled', 'MODULE_NOT_ENTITLED');
  }
  return { status: entitlement.status };
}

async function loadActiveSeatPricing(): Promise<{
  currency: string;
  unit_price_amount: number;
  billing_period: string;
  default_included_staff_seats: number;
  trial_included_staff_seats: number;
}> {
  const { data } = await supabaseAdmin
    .from('platform_staff_seat_pricing')
    .select(
      'currency, unit_price_amount, billing_period, default_included_staff_seats, trial_included_staff_seats',
    )
    .eq('code', 'default')
    .eq('is_active', true)
    .maybeSingle();
  if (!data) {
    return {
      currency: 'ILS',
      unit_price_amount: 0,
      billing_period: 'month',
      default_included_staff_seats: 0,
      trial_included_staff_seats: 1,
    };
  }
  const row = data as {
    currency: string;
    unit_price_amount: number;
    billing_period: string;
    default_included_staff_seats: number;
    trial_included_staff_seats: number;
  };
  return {
    currency: row.currency,
    unit_price_amount: Number(row.unit_price_amount),
    billing_period: row.billing_period,
    default_included_staff_seats: Number(row.default_included_staff_seats) || 0,
    trial_included_staff_seats: Number(row.trial_included_staff_seats) || 0,
  };
}

async function loadEntitlementRow(organizationId: string): Promise<{
  purchased: number;
  grandfathered: number;
  included_override: number | null;
}> {
  const { data } = await supabaseAdmin
    .from('organization_staff_seat_entitlements')
    .select(
      'purchased_additional_staff_seats, grandfathered_staff_seats, included_staff_seats_override',
    )
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (!data) return { purchased: 0, grandfathered: 0, included_override: null };
  const row = data as {
    purchased_additional_staff_seats: number;
    grandfathered_staff_seats: number;
    included_staff_seats_override: number | null;
  };
  return {
    purchased: Math.max(0, Math.floor(Number(row.purchased_additional_staff_seats) || 0)),
    grandfathered: Math.max(0, Math.floor(Number(row.grandfathered_staff_seats) || 0)),
    included_override:
      row.included_staff_seats_override == null
        ? null
        : Math.max(0, Math.floor(Number(row.included_staff_seats_override))),
  };
}

async function loadPlanIncludedStaffSeats(organizationId: string): Promise<number> {
  const { data: subs } = await supabaseAdmin
    .from('organization_module_subscriptions')
    .select('module_plan_id')
    .eq('organization_id', organizationId)
    .in('status', ['active', 'trialing']);
  const planIds = [...new Set((subs ?? []).map((s) => String((s as { module_plan_id: string }).module_plan_id)))];
  if (!planIds.length) return 0;
  const { data: limits } = await supabaseAdmin
    .from('module_plan_limits')
    .select('limit_value')
    .in('module_plan_id', planIds)
    .eq('limit_code', 'included_staff_seats')
    .eq('is_unlimited', false);
  let max = 0;
  for (const row of limits ?? []) {
    const v = Number((row as { limit_value: number | null }).limit_value);
    if (Number.isFinite(v)) max = Math.max(max, Math.floor(v));
  }
  return max;
}

export async function countActiveStaffSeatConsumers(organizationId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('organization_memberships')
    .select('role_code')
    .eq('organization_id', organizationId)
    .eq('status', 'active');
  if (error) throw new Error(error.message);
  return (data ?? []).filter((r) => roleConsumesStaffSeat((r as { role_code: string }).role_code)).length;
}

async function loadModulesRecurringTotal(organizationId: string): Promise<{
  amount: number;
  currency: string | null;
}> {
  const { data: subs } = await supabaseAdmin
    .from('organization_module_subscriptions')
    .select('status, module_plans(currency, price_amount)')
    .eq('organization_id', organizationId)
    .in('status', ['active', 'trialing']);
  let amount = 0;
  const currencies = new Set<string>();
  for (const row of subs ?? []) {
    const planRaw = (row as { module_plans?: unknown }).module_plans;
    const plan = (Array.isArray(planRaw) ? planRaw[0] : planRaw) as
      | { currency?: string; price_amount?: number }
      | null;
    if (!plan) continue;
    amount += Number(plan.price_amount) || 0;
    if (plan.currency) currencies.add(plan.currency);
  }
  return { amount, currency: currencies.size === 1 ? [...currencies][0]! : null };
}

export async function resolveStaffSeatEntitlement(
  organizationId: string,
): Promise<StaffSeatEntitlementTruth> {
  const [pricing, entitlementRow, planIncluded, consumed, onTrial, modulesTotal] = await Promise.all([
    loadActiveSeatPricing(),
    loadEntitlementRow(organizationId),
    loadPlanIncludedStaffSeats(organizationId),
    countActiveStaffSeatConsumers(organizationId),
    hasValidTrial(organizationId),
    loadModulesRecurringTotal(organizationId),
  ]);

  let included: number;
  if (entitlementRow.included_override != null) {
    included = entitlementRow.included_override;
  } else if (onTrial) {
    included = Math.max(pricing.trial_included_staff_seats, planIncluded);
  } else {
    included = Math.max(pricing.default_included_staff_seats, planIncluded);
  }

  const seats = computeStaffSeatAvailability({
    included_staff_seats: included,
    grandfathered_staff_seats: entitlementRow.grandfathered,
    purchased_staff_seats: entitlementRow.purchased,
    active_consumed_staff_seats: consumed,
  });

  const currency = modulesTotal.currency ?? pricing.currency;
  const totals = computeCommercialRecurringTotals({
    modules_recurring_total_amount: modulesTotal.amount,
    purchased_staff_seats: seats.purchased_staff_seats,
    seat_unit_price_amount: pricing.unit_price_amount,
    currency,
  });

  return {
    ...seats,
    seat_unit_price_amount: pricing.unit_price_amount,
    seat_currency: pricing.currency,
    seat_billing_period: pricing.billing_period,
    ...totals,
    commercial_currency: currency,
    trial_staff_seat_policy: 'finite_trial_allowance',
    on_full_platform_trial: onTrial,
  };
}

export async function assertStaffSeatCapacity(
  organizationId: string,
  proposed: { roleCode: string; alreadyActiveConsuming?: boolean },
): Promise<StaffSeatEntitlementTruth> {
  const truth = await resolveStaffSeatEntitlement(organizationId);
  if (!roleConsumesStaffSeat(proposed.roleCode)) return truth;
  if (proposed.alreadyActiveConsuming) return truth;
  if (truth.available_staff_seats <= 0) {
    throw conflict('No available staff seats for this organization', SEAT_CAPACITY_CODE, {
      organization_id: organizationId,
      included_staff_seats: truth.included_staff_seats,
      grandfathered_staff_seats: truth.grandfathered_staff_seats,
      purchased_staff_seats: truth.purchased_staff_seats,
      entitled_staff_seats: truth.entitled_staff_seats,
      active_consumed_staff_seats: truth.active_consumed_staff_seats,
      available_staff_seats: truth.available_staff_seats,
    });
  }
  return truth;
}

function mapSeatRpcError(error: { message?: string; details?: string; code?: string } | null): never {
  const msg = String(error?.message ?? error?.details ?? '');
  if (msg.includes('STAFF_SEAT_CAPACITY_EXCEEDED')) {
    throw conflict('No available staff seats for this organization', SEAT_CAPACITY_CODE, {
      rpc: true,
      detail: error?.details ?? null,
    });
  }
  if (msg.includes('STAFF_SEAT_REDUCTION_BLOCKED_BY_CONSUMPTION')) {
    throw conflict(
      'Cannot reduce staff seat entitlement below active seat consumption',
      SEAT_REDUCTION_CODE,
      { rpc: true, detail: error?.details ?? null },
    );
  }
  if (msg.includes('STAFF_SEAT_ALREADY_ACTIVE_MEMBER')) {
    throw badRequest('Already a member');
  }
  if (msg.includes('STAFF_SEAT_INVALID_QUANTITY')) {
    throw badRequest('purchased_additional_staff_seats must be >= 0', 'INVALID_SEAT_QUANTITY');
  }
  if (msg.includes('STAFF_SEAT_INVALID_ROLE')) {
    throw badRequest('Invalid role');
  }
  if (msg.includes('STAFF_SEAT_MEMBER_NOT_FOUND')) {
    throw forbidden('Member not found');
  }
  if (msg.includes('STAFF_SEAT_CANNOT_MODIFY_OWNER')) {
    throw forbidden('Cannot modify owner');
  }
  throw new AppError(500, msg || 'Staff seat RPC failed', 'STAFF_SEAT_RPC_FAILED');
}

/** Concurrent-safe activation used by invite accept / reactivation. */
export async function activateMembershipWithStaffSeatGuard(params: {
  organizationId: string;
  userId: string;
  roleCode: string;
  invitedBy?: string | null;
  actorUserId: string | null;
}): Promise<{ membership_id: string }> {
  const { data, error } = await supabaseAdmin.rpc(
    'activate_organization_membership_with_staff_seat_guard',
    {
      p_organization_id: params.organizationId,
      p_user_id: params.userId,
      p_role_code: params.roleCode,
      p_invited_by: params.invitedBy ?? null,
    },
  );
  if (error) {
    if (String(error.message ?? '').includes('STAFF_SEAT_CAPACITY_EXCEEDED')) {
      await writeAudit({
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        entityType: 'organization_staff_seat_entitlement',
        entityId: params.organizationId,
        action: AUDIT_ACTIONS.STAFF_SEAT_CAPACITY_ACTIVATION_REJECTED,
        payload: {
          user_id: params.userId,
          role_code: params.roleCode,
          reason: SEAT_CAPACITY_CODE,
        },
      });
    }
    mapSeatRpcError(error);
  }
  const row = data as { membership_id?: string } | null;
  return { membership_id: String(row?.membership_id ?? '') };
}

export async function changeMembershipRoleWithStaffSeatGuard(params: {
  organizationId: string;
  membershipId: string;
  newRoleCode: string;
  actorUserId: string | null;
}): Promise<{ user_id: string; from_role: string; to_role: string }> {
  const { data, error } = await supabaseAdmin.rpc(
    'change_organization_membership_role_with_staff_seat_guard',
    {
      p_organization_id: params.organizationId,
      p_membership_id: params.membershipId,
      p_new_role_code: params.newRoleCode,
    },
  );
  if (error) {
    if (String(error.message ?? '').includes('STAFF_SEAT_CAPACITY_EXCEEDED')) {
      await writeAudit({
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        entityType: 'organization_staff_seat_entitlement',
        entityId: params.organizationId,
        action: AUDIT_ACTIONS.STAFF_SEAT_CAPACITY_ACTIVATION_REJECTED,
        payload: {
          membership_id: params.membershipId,
          role_code: params.newRoleCode,
          reason: SEAT_CAPACITY_CODE,
        },
      });
    }
    mapSeatRpcError(error);
  }
  const row = data as { user_id: string; from_role: string; to_role: string };
  return row;
}

export async function setOrganizationStaffSeatQuantityCommand(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<{
  ok: true;
  command: 'set_organization_staff_seat_quantity';
  seats: StaffSeatEntitlementTruth;
  organization_id: string;
}> {
  assertPlatformOwner(ctx);

  const organizationId = String(payload.organization_id ?? '').trim();
  if (!organizationId) throw badRequest('organization_id required');

  // Never trust frontend price.
  if (payload.seat_unit_price_amount !== undefined || payload.unit_price !== undefined || payload.price !== undefined) {
    // Ignored intentionally — price is Billing catalog only.
  }

  const quantityRaw = payload.purchased_additional_staff_seats ?? payload.quantity;
  if (quantityRaw === undefined || quantityRaw === null || quantityRaw === '') {
    throw badRequest('purchased_additional_staff_seats (quantity) required');
  }
  const quantity = Number(quantityRaw);
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw badRequest('purchased_additional_staff_seats must be an integer >= 0', 'INVALID_SEAT_QUANTITY');
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id')
    .eq('id', organizationId)
    .maybeSingle();
  if (!org) throw badRequest('Organization not found');

  const before = await resolveStaffSeatEntitlement(organizationId);

  const { data, error } = await supabaseAdmin.rpc('set_organization_purchased_staff_seats', {
    p_organization_id: organizationId,
    p_purchased_additional_staff_seats: quantity,
  });
  if (error) mapSeatRpcError(error);

  const after = await resolveStaffSeatEntitlement(organizationId);

  await writeAudit({
    organizationId,
    actorUserId: ctx.user.id,
    entityType: 'organization_staff_seat_entitlement',
    entityId: organizationId,
    action: AUDIT_ACTIONS.STAFF_SEAT_ENTITLEMENT_QUANTITY_CHANGED,
    payload: {
      previous_purchased_staff_seats: before.purchased_staff_seats,
      purchased_staff_seats: after.purchased_staff_seats,
      grandfathered_staff_seats: after.grandfathered_staff_seats,
      grandfathered_unchanged: before.grandfathered_staff_seats === after.grandfathered_staff_seats,
      entitled_staff_seats: after.entitled_staff_seats,
      active_consumed_staff_seats: after.active_consumed_staff_seats,
      rpc_result: data ?? null,
      // Explicit: any client-supplied price was ignored.
      frontend_price_ignored: true,
    },
  });

  return {
    ok: true,
    command: 'set_organization_staff_seat_quantity',
    seats: after,
    organization_id: organizationId,
  };
}

export function buildOwnerCommercialSeatsSection(truth: StaffSeatEntitlementTruth): Record<string, string | number | null> {
  return {
    included_staff_seats: truth.included_staff_seats,
    grandfathered_staff_seats: truth.grandfathered_staff_seats,
    purchased_additional_staff_seats: truth.purchased_staff_seats,
    entitled_staff_seats: truth.entitled_staff_seats,
    active_consumed_staff_seats: truth.active_consumed_staff_seats,
    available_staff_seats: truth.available_staff_seats,
    seats_used_label: `${truth.active_consumed_staff_seats} / ${truth.entitled_staff_seats}`,
    seat_unit_price_amount: truth.seat_unit_price_amount,
    seat_unit_price_label: `${truth.seat_currency} ${truth.seat_unit_price_amount.toFixed(2)} / ${truth.seat_billing_period}`,
    modules_recurring_total_amount: truth.modules_recurring_total_amount,
    seats_recurring_total_amount: truth.seats_recurring_total_amount,
    commercial_recurring_total_amount: truth.commercial_recurring_total_amount,
    commercial_recurring_total_label: `${truth.commercial_currency} ${truth.commercial_recurring_total_amount.toFixed(2)}`,
    commercial_currency: truth.commercial_currency,
    trial_staff_seat_policy: truth.trial_staff_seat_policy,
    on_full_platform_trial: truth.on_full_platform_trial ? 'yes' : 'no',
  };
}
