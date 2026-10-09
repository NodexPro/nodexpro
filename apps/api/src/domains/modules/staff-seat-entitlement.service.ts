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
  projectStaffSeatOrganization,
  roleConsumesStaffSeat,
  type StaffSeatEntitlementTruth,
  type StaffSeatOrgProjection,
  type StaffSeatTermVersion,
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

function staffSeatAsOfDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// Canonical purchased quantity is organization_staff_seat_commercial_terms.
// purchased_additional_staff_seats remains a LEGACY COMPATIBILITY MIRROR for the
// pre-183 API and is intentionally not read here.
async function loadEntitlementRow(organizationId: string): Promise<{
  grandfathered: number;
  included_override: number | null;
}> {
  const { data } = await supabaseAdmin
    .from('organization_staff_seat_entitlements')
    .select('grandfathered_staff_seats, included_staff_seats_override')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (!data) return { grandfathered: 0, included_override: null };
  const row = data as {
    grandfathered_staff_seats: number;
    included_staff_seats_override: number | null;
  };
  return {
    grandfathered: Math.max(0, Math.floor(Number(row.grandfathered_staff_seats) || 0)),
    included_override:
      row.included_staff_seats_override == null
        ? null
        : Math.max(0, Math.floor(Number(row.included_staff_seats_override))),
  };
}

async function loadStaffSeatTermVersions(organizationIds: string[]): Promise<Map<string, StaffSeatTermVersion[]>> {
  const grouped = new Map<string, StaffSeatTermVersion[]>();
  if (!organizationIds.length) return grouped;
  const { data, error } = await supabaseAdmin
    .from('organization_staff_seat_commercial_terms')
    .select(
      'organization_id, effective_from, effective_to, additional_seat_quantity, currency, unit_price_amount, discount_percent, billing_period',
    )
    .in('organization_id', organizationIds);
  if (error) throw error;
  for (const raw of data ?? []) {
    const row = raw as {
      organization_id: string;
      effective_from: string;
      effective_to: string | null;
      additional_seat_quantity: number;
      currency: string | null;
      unit_price_amount: number | null;
      discount_percent: number;
      billing_period: string;
    };
    const version: StaffSeatTermVersion = {
      effective_from: String(row.effective_from).slice(0, 10),
      effective_to: row.effective_to ? String(row.effective_to).slice(0, 10) : null,
      additional_seat_quantity: Math.max(0, Math.floor(Number(row.additional_seat_quantity) || 0)),
      currency: row.currency ? String(row.currency).trim() : null,
      unit_price_amount: row.unit_price_amount == null ? null : Number(row.unit_price_amount),
      discount_percent: Number(row.discount_percent) || 0,
      billing_period: row.billing_period === 'year' ? 'year' : 'month',
    };
    const list = grouped.get(row.organization_id) ?? [];
    list.push(version);
    grouped.set(row.organization_id, list);
  }
  return grouped;
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
  const [pricing, entitlementRow, planIncluded, consumed, onTrial, modulesTotal, termsByOrg] = await Promise.all([
    loadActiveSeatPricing(),
    loadEntitlementRow(organizationId),
    loadPlanIncludedStaffSeats(organizationId),
    countActiveStaffSeatConsumers(organizationId),
    hasValidTrial(organizationId),
    loadModulesRecurringTotal(organizationId),
    loadStaffSeatTermVersions([organizationId]),
  ]);

  let included: number;
  if (entitlementRow.included_override != null) {
    included = entitlementRow.included_override;
  } else if (onTrial) {
    included = Math.max(pricing.trial_included_staff_seats, planIncluded);
  } else {
    included = Math.max(pricing.default_included_staff_seats, planIncluded);
  }

  const projection = projectStaffSeatOrganization({
    as_of: staffSeatAsOfDate(),
    versions: termsByOrg.get(organizationId) ?? [],
    included_staff_seats: included,
    grandfathered_staff_seats: entitlementRow.grandfathered,
    active_consumed_staff_seats: consumed,
  });
  const seats = computeStaffSeatAvailability({
    included_staff_seats: projection.included_staff_seats,
    grandfathered_staff_seats: projection.grandfathered_staff_seats,
    purchased_staff_seats: projection.purchased_additional_staff_seats,
    active_consumed_staff_seats: projection.used_staff_seats,
  });
  const agreedUnit = projection.current_terms?.effective_unit_price ?? 0;

  const currency = projection.current_terms?.currency ?? modulesTotal.currency ?? pricing.currency;
  const totals = computeCommercialRecurringTotals({
    modules_recurring_total_amount: modulesTotal.amount,
    purchased_staff_seats: seats.purchased_staff_seats,
    seat_unit_price_amount: agreedUnit,
    currency,
  });

  return {
    ...seats,
    seat_unit_price_amount: agreedUnit,
    seat_currency: currency,
    seat_billing_period: projection.current_terms?.billing_cadence ?? pricing.billing_period,
    ...totals,
    commercial_currency: currency,
    trial_staff_seat_policy: 'finite_trial_allowance',
    on_full_platform_trial: onTrial,
    seat_charge_label: projection.seat_charge_label,
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
  if (msg.includes('STAFF_SEAT_TERMS_HISTORY_IMMUTABLE')) {
    throw conflict('Closed staff-seat terms cannot be rewritten', 'STAFF_SEAT_TERMS_HISTORY_IMMUTABLE');
  }
  if (msg.includes('STAFF_SEAT_INVALID_PRICE')) {
    throw badRequest('unit_price_amount must be >= 0', 'INVALID_SEAT_PRICE');
  }
  if (msg.includes('STAFF_SEAT_INVALID_DISCOUNT')) {
    throw badRequest('discount_percent must be between 0 and 100', 'INVALID_SEAT_DISCOUNT');
  }
  if (msg.includes('STAFF_SEAT_INVALID_CURRENCY')) {
    throw badRequest('currency must be a 3-letter code when a unit price is set', 'INVALID_SEAT_CURRENCY');
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

  // Preserved (uuid, int) signature. SQL writes today's terms and the legacy mirror together.
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
      effective_from: staffSeatAsOfDate(),
      previous_purchased_staff_seats: before.purchased_staff_seats,
      purchased_staff_seats: after.purchased_staff_seats,
      previous_unit_price_amount: (data as { previous_unit_price_amount?: number | null } | null)?.previous_unit_price_amount ?? null,
      unit_price_amount: (data as { unit_price_amount?: number | null } | null)?.unit_price_amount ?? null,
      previous_discount_percent: (data as { previous_discount_percent?: number | null } | null)?.previous_discount_percent ?? null,
      discount_percent: (data as { discount_percent?: number | null } | null)?.discount_percent ?? null,
      currency: (data as { currency?: string | null } | null)?.currency ?? null,
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

export async function loadStaffSeatOrgProjections(organizationIds: string[]): Promise<Map<string, StaffSeatOrgProjection>> {
  const unique = [...new Set(organizationIds.filter(Boolean))];
  const result = new Map<string, StaffSeatOrgProjection>();
  if (!unique.length) return result;
  const asOf = staffSeatAsOfDate();
  const [pricing, termsByOrg, entitlementRes, memberRes] = await Promise.all([
    loadActiveSeatPricing(),
    loadStaffSeatTermVersions(unique),
    supabaseAdmin
      .from('organization_staff_seat_entitlements')
      .select('organization_id, grandfathered_staff_seats, included_staff_seats_override')
      .in('organization_id', unique),
    supabaseAdmin
      .from('organization_memberships')
      .select('organization_id, role_code')
      .in('organization_id', unique)
      .eq('status', 'active'),
  ]);
  if (entitlementRes.error) throw entitlementRes.error;
  if (memberRes.error) throw memberRes.error;

  const grandfatheredByOrg = new Map<string, number>();
  const overrideByOrg = new Map<string, number | null>();
  for (const raw of entitlementRes.data ?? []) {
    const row = raw as {
      organization_id: string;
      grandfathered_staff_seats: number;
      included_staff_seats_override: number | null;
    };
    grandfatheredByOrg.set(row.organization_id, Math.max(0, Math.floor(Number(row.grandfathered_staff_seats) || 0)));
    overrideByOrg.set(
      row.organization_id,
      row.included_staff_seats_override == null ? null : Math.max(0, Math.floor(Number(row.included_staff_seats_override))),
    );
  }
  const consumedByOrg = new Map<string, number>();
  for (const raw of memberRes.data ?? []) {
    const row = raw as { organization_id: string; role_code: string };
    if (!roleConsumesStaffSeat(row.role_code)) continue;
    consumedByOrg.set(row.organization_id, (consumedByOrg.get(row.organization_id) ?? 0) + 1);
  }

  await Promise.all(
    unique.map(async (organizationId) => {
      const override = overrideByOrg.get(organizationId) ?? null;
      let included = override ?? pricing.default_included_staff_seats;
      if (override == null) {
        const [planIncluded, onTrial] = await Promise.all([
          loadPlanIncludedStaffSeats(organizationId),
          hasValidTrial(organizationId),
        ]);
        included = onTrial
          ? Math.max(pricing.trial_included_staff_seats, planIncluded)
          : Math.max(pricing.default_included_staff_seats, planIncluded);
      }
      result.set(
        organizationId,
        projectStaffSeatOrganization({
          as_of: asOf,
          versions: termsByOrg.get(organizationId) ?? [],
          included_staff_seats: included,
          grandfathered_staff_seats: grandfatheredByOrg.get(organizationId) ?? 0,
          active_consumed_staff_seats: consumedByOrg.get(organizationId) ?? 0,
        }),
      );
    }),
  );
  return result;
}

function readOptionalMoney(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw badRequest('unit_price_amount must be >= 0', 'INVALID_SEAT_PRICE');
  }
  return amount;
}

export async function setOrganizationStaffSeatTermsCommand(
  ctx: RequestContext,
  payload: Record<string, unknown>,
): Promise<{ ok: true; command: 'set_organization_staff_seat_terms'; organization_id: string }> {
  assertPlatformOwner(ctx);
  const organizationId = String(payload.organization_id ?? '').trim();
  if (!organizationId) throw badRequest('organization_id required');
  const effectiveFrom = String(payload.effective_from ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    throw badRequest('effective_from must be YYYY-MM-DD', 'INVALID_SEAT_EFFECTIVE_DATE');
  }
  const quantity = Number(payload.additional_seat_quantity);
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw badRequest('additional_seat_quantity must be an integer >= 0', 'INVALID_SEAT_QUANTITY');
  }
  const unitPrice = readOptionalMoney(payload.unit_price_amount);
  const currencyRaw = payload.currency == null || payload.currency === '' ? null : String(payload.currency).trim();
  if (unitPrice == null && currencyRaw) {
    throw badRequest('currency requires unit_price_amount', 'INVALID_SEAT_CURRENCY');
  }
  if (unitPrice != null && !/^[A-Za-z]{3}$/.test(currencyRaw ?? '')) {
    throw badRequest('currency must be a 3-letter code when a unit price is set', 'INVALID_SEAT_CURRENCY');
  }
  const discount = payload.discount_percent == null || payload.discount_percent === '' ? 0 : Number(payload.discount_percent);
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
    throw badRequest('discount_percent must be between 0 and 100', 'INVALID_SEAT_DISCOUNT');
  }

  const { data: org } = await supabaseAdmin.from('organizations').select('id').eq('id', organizationId).maybeSingle();
  if (!org) throw badRequest('Organization not found');

  const before = await resolveStaffSeatEntitlement(organizationId);
  const { data, error } = await supabaseAdmin.rpc('apply_organization_staff_seat_commercial_terms', {
    p_organization_id: organizationId,
    p_effective_from: effectiveFrom,
    p_additional_seat_quantity: quantity,
    p_unit_price_amount: unitPrice,
    p_currency: currencyRaw,
    p_discount_percent: discount,
    p_preserve_commercial_price: false,
    p_created_by: ctx.user.id,
  });
  if (error) mapSeatRpcError(error);
  const after = await resolveStaffSeatEntitlement(organizationId);
  const rpc = (data ?? {}) as {
    previous_additional_seat_quantity?: number | null;
    previous_unit_price_amount?: number | null;
    previous_discount_percent?: number | null;
    previous_currency?: string | null;
    unit_price_amount?: number | null;
    discount_percent?: number | null;
    currency?: string | null;
  };

  await writeAudit({
    organizationId,
    actorUserId: ctx.user.id,
    entityType: 'organization_staff_seat_commercial_terms',
    entityId: organizationId,
    action: AUDIT_ACTIONS.STAFF_SEAT_COMMERCIAL_TERMS_SET,
    payload: {
      effective_from: effectiveFrom,
      previous_additional_seat_quantity: rpc.previous_additional_seat_quantity ?? before.purchased_staff_seats,
      additional_seat_quantity: quantity,
      previous_unit_price_amount: rpc.previous_unit_price_amount ?? null,
      unit_price_amount: rpc.unit_price_amount ?? null,
      previous_discount_percent: rpc.previous_discount_percent ?? null,
      discount_percent: rpc.discount_percent ?? discount,
      previous_currency: rpc.previous_currency ?? null,
      currency: rpc.currency ?? null,
      grandfathered_staff_seats: after.grandfathered_staff_seats,
      grandfathered_unchanged: before.grandfathered_staff_seats === after.grandfathered_staff_seats,
      entitled_staff_seats: after.entitled_staff_seats,
      active_consumed_staff_seats: after.active_consumed_staff_seats,
    },
  });

  return { ok: true, command: 'set_organization_staff_seat_terms', organization_id: organizationId };
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
    seat_unit_price_amount: truth.seat_charge_label === '—' ? null : truth.seat_unit_price_amount,
    seat_unit_price_label: truth.seat_charge_label ?? '—',
    modules_recurring_total_amount: truth.modules_recurring_total_amount,
    seats_recurring_total_amount: truth.seats_recurring_total_amount,
    commercial_recurring_total_amount: truth.commercial_recurring_total_amount,
    commercial_recurring_total_label: `${truth.commercial_currency} ${truth.commercial_recurring_total_amount.toFixed(2)}`,
    commercial_currency: truth.commercial_currency,
    trial_staff_seat_policy: truth.trial_staff_seat_policy,
    on_full_platform_trial: truth.on_full_platform_trial ? 'yes' : 'no',
  };
}
