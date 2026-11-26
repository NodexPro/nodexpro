import crypto from 'crypto';
import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, conflict, forbidden } from '../../shared/errors.js';
import { RBAC_PERMISSIONS, requireRbacPermission } from '../rbac/rbac.service.js';
import { mapSeatRpcError, resolveStaffSeatEntitlement } from '../modules/staff-seat-entitlement.service.js';
import { applyAuthoritativeSellerVat, resolvePlatformSellerVat } from '../billing/platform-seller-vat.service.js';
import { buildUsersRolesAggregate } from '../memberships/users-roles-aggregate.service.js';
import {
  buildStaffSeatPurchaseQuote,
  canActivateSeatPurchase,
  nextPurchasedSeatQuantity,
  normalizeSeatPurchaseQuantity,
} from './staff-seat-purchase-quote.pure.js';

function assertOfficeWriter(ctx: RequestContext, orgId: string) {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
  requireRbacPermission(ctx, orgId, RBAC_PERMISSIONS.invite_users);
}

async function quoteForOrg(orgId: string, quantity: number) {
  const asOfDate = new Date().toISOString().slice(0, 10);
  const [truth, vat] = await Promise.all([
    resolveStaffSeatEntitlement(orgId),
    resolvePlatformSellerVat(asOfDate),
  ]);
  const appliedVat = applyAuthoritativeSellerVat(vat);
  return {
    truth,
    quote: buildStaffSeatPurchaseQuote({
      quantity,
      catalogUnitPrice: Number(truth.list_unit_price_amount ?? 0),
      officeCurrentUnitPrice: truth.current_terms_unit_price_amount ?? null,
      currency: truth.seat_currency,
      billingPeriod: truth.seat_billing_period,
      vatRate: appliedVat.vatRate,
      vatPercentLabel: appliedVat.vatPercentLabel,
    }),
  };
}

export async function quoteStaffSeatPurchaseCommand(
  ctx: RequestContext,
  orgId: string,
  payload: Record<string, unknown>,
) {
  assertOfficeWriter(ctx, orgId);
  const quantity = normalizeSeatPurchaseQuantity(payload.quantity);
  if (quantity == null) throw badRequest('quantity must be an integer from 1 to 99', 'INVALID_SEAT_QUANTITY');
  const { quote } = await quoteForOrg(orgId, quantity);
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'staff_seat_purchase_intent',
    action: AUDIT_ACTIONS.STAFF_SEAT_PURCHASE_QUOTED,
    payload: { quantity: quote.quantity, total_amount: quote.total_amount, currency: quote.currency, checkout_available: false },
  });
  return {
    ok: true as const,
    command: 'quote_staff_seat_purchase' as const,
    quote,
    users_roles_aggregate: await buildUsersRolesAggregate(ctx, orgId, { quoteQuantity: quantity }),
  };
}

export async function createStaffSeatPurchaseIntentCommand(
  ctx: RequestContext,
  orgId: string,
  payload: Record<string, unknown>,
) {
  assertOfficeWriter(ctx, orgId);
  const quantity = normalizeSeatPurchaseQuantity(payload.quantity) ?? 1;
  const { quote, truth } = await quoteForOrg(orgId, quantity);
  const { data: openIntent } = await supabaseAdmin
    .from('staff_seat_purchase_intents')
    .select('id, status, quantity, idempotency_key')
    .eq('organization_id', orgId)
    .in('status', ['quoted', 'pending_payment'])
    .maybeSingle();
  if (openIntent) {
    return {
      ok: true as const,
      command: 'create_staff_seat_purchase_intent' as const,
      intent: { id: openIntent.id, status: openIntent.status, checkout_url: null, checkout_available: false },
      users_roles_aggregate: await buildUsersRolesAggregate(ctx, orgId, { quoteQuantity: Number(openIntent.quantity) || quantity }),
    };
  }
  const idempotencyKey =
    String(payload.idempotency_key ?? '').trim() || `seat:${orgId}:${quantity}:${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await supabaseAdmin
    .from('staff_seat_purchase_intents')
    .select('id, status')
    .eq('organization_id', orgId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (existing && (existing as { status: string }).status === 'activated') {
    throw conflict('Purchase already activated', 'STAFF_SEAT_PURCHASE_ALREADY_ACTIVATED');
  }
  const { data, error } = await supabaseAdmin
    .from('staff_seat_purchase_intents')
    .upsert(
      {
        organization_id: orgId,
        quantity: quote.quantity,
        currency: quote.currency,
        unit_price_net: quote.unit_price_net,
        net_amount: quote.net_amount,
        vat_rate: quote.vat_rate,
        vat_amount: quote.vat_amount,
        total_amount: quote.total_amount,
        price_source: quote.price_source,
        catalog_unit_price_net: quote.catalog_unit_price_net,
        billing_period: quote.billing_period,
        status: 'quoted',
        idempotency_key: idempotencyKey,
        expires_at: expiresAt,
        created_by_user_id: ctx.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,idempotency_key' },
    )
    .select('id, status')
    .maybeSingle();
  if (error) throw error;
  await supabaseAdmin.from('platform_billing_subscriptions').upsert(
    {
      organization_id: orgId,
      kind: 'staff_seats',
      status: 'unavailable',
      quantity: truth.purchased_staff_seats,
      currency: quote.currency,
      unit_price_net: quote.unit_price_net,
      billing_period: quote.billing_period,
      last_intent_id: data?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id,kind' },
  );
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'staff_seat_purchase_intent',
    entityId: data?.id ?? null,
    action: AUDIT_ACTIONS.STAFF_SEAT_PURCHASE_INTENT_CREATED,
    payload: { quantity: quote.quantity, status: 'quoted', checkout_available: false, entitlement_changed: false },
  });
  return {
    ok: true as const,
    command: 'create_staff_seat_purchase_intent' as const,
    intent: { id: data?.id ?? null, status: 'quoted', checkout_url: null, checkout_available: false },
    users_roles_aggregate: await buildUsersRolesAggregate(ctx, orgId, { quoteQuantity: quantity }),
  };
}

export async function cancelStaffSeatPurchaseIntentCommand(
  ctx: RequestContext,
  orgId: string,
  payload: Record<string, unknown>,
) {
  assertOfficeWriter(ctx, orgId);
  const intentId = String(payload.intent_id ?? '').trim();
  if (!intentId) throw badRequest('intent_id required');
  const { data: row, error } = await supabaseAdmin
    .from('staff_seat_purchase_intents')
    .select('id, status, organization_id')
    .eq('id', intentId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw badRequest('Intent not found', 'STAFF_SEAT_PURCHASE_NOT_FOUND');
  if ((row as { status: string }).status === 'activated') {
    throw conflict('Activated purchases cannot be cancelled', 'STAFF_SEAT_PURCHASE_ALREADY_ACTIVATED');
  }
  await supabaseAdmin
    .from('staff_seat_purchase_intents')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', intentId)
    .eq('organization_id', orgId)
    .in('status', ['quoted', 'pending_payment']);
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'staff_seat_purchase_intent',
    entityId: intentId,
    action: AUDIT_ACTIONS.STAFF_SEAT_PURCHASE_INTENT_CANCELLED,
    payload: { previous_status: (row as { status: string }).status },
  });
  return {
    ok: true as const,
    command: 'cancel_staff_seat_purchase_intent' as const,
    users_roles_aggregate: await buildUsersRolesAggregate(ctx, orgId),
  };
}

/**
 * Internal only. Never call from a browser success redirect.
 * Uses existing apply_organization_staff_seat_commercial_terms; does not invent a second seat counter.
 */
export async function activateStaffSeatPurchaseFromVerifiedPayment(input: {
  organizationId: string;
  intentId: string;
  paymentTransactionId: string;
  actorUserId: string | null;
}) {
  const { data: intent, error } = await supabaseAdmin
    .from('staff_seat_purchase_intents')
    .select('*')
    .eq('id', input.intentId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!intent) throw badRequest('Intent not found', 'STAFF_SEAT_PURCHASE_NOT_FOUND');
  const gate = canActivateSeatPurchase({
    intentStatus: String(intent.status),
    paymentVerified: Boolean(input.paymentTransactionId),
    alreadyActivated: Boolean(intent.activated_at) || intent.status === 'activated',
  });
  if (!gate.ok) {
    await writeAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      entityType: 'staff_seat_purchase_intent',
      entityId: input.intentId,
      action: AUDIT_ACTIONS.STAFF_SEAT_PURCHASE_ACTIVATION_BLOCKED,
      payload: { code: gate.code },
    });
    throw conflict('Seat purchase cannot be activated', gate.code);
  }
  const { data: payment } = await supabaseAdmin
    .from('payment_transactions')
    .select('id, status, seller_context, organization_id')
    .eq('id', input.paymentTransactionId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (!payment || payment.status !== 'verified' || payment.seller_context !== 'nodexpro_platform') {
    throw conflict('Verified platform payment required', 'NOT_PAID');
  }
  const truth = await resolveStaffSeatEntitlement(input.organizationId);
  const nextQty = nextPurchasedSeatQuantity(truth.purchased_staff_seats, Number(intent.quantity));
  const unitPrice =
    intent.price_source === 'office_commercial_terms'
      ? Number(truth.current_terms_unit_price_amount ?? intent.unit_price_net)
      : Number(intent.unit_price_net);
  const { error: rpcError } = await supabaseAdmin.rpc('apply_organization_staff_seat_commercial_terms', {
    p_organization_id: input.organizationId,
    p_effective_from: new Date().toISOString().slice(0, 10),
    p_additional_seat_quantity: nextQty,
    p_unit_price_amount: unitPrice,
    p_currency: intent.currency,
    p_discount_percent: 0,
    p_preserve_commercial_price: intent.price_source === 'office_commercial_terms',
    p_created_by: input.actorUserId,
  });
  if (rpcError) mapSeatRpcError(rpcError);
  const { data: updated } = await supabaseAdmin
    .from('staff_seat_purchase_intents')
    .update({
      status: 'activated',
      payment_transaction_id: input.paymentTransactionId,
      activated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.intentId)
    .eq('organization_id', input.organizationId)
    .neq('status', 'activated')
    .select('id, status')
    .maybeSingle();
  if (!updated) {
    throw conflict('Purchase already activated', 'STAFF_SEAT_PURCHASE_ALREADY_ACTIVATED');
  }
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: 'staff_seat_purchase_intent',
    entityId: input.intentId,
    action: AUDIT_ACTIONS.STAFF_SEAT_PURCHASE_ACTIVATED,
    payload: { additional_seat_quantity: nextQty, payment_transaction_id: input.paymentTransactionId },
  });
  return { ok: true as const, intent_id: input.intentId, additional_seat_quantity: nextQty };
}

export async function rejectClientSidePurchaseConfirmation() {
  throw forbidden('Client redirect is not payment proof', 'PAYMENT_CLIENT_REDIRECT_REJECTED');
}

export function isStaffSeatPurchaseCommand(command: string): boolean {
  return (
    command === 'quote_staff_seat_purchase' ||
    command === 'create_staff_seat_purchase_intent' ||
    command === 'cancel_staff_seat_purchase_intent' ||
    command === 'confirm_staff_seat_purchase_from_client'
  );
}

export async function executeStaffSeatPurchaseCommand(
  ctx: RequestContext,
  orgId: string,
  command: string,
  payload: Record<string, unknown>,
) {
  if (command === 'confirm_staff_seat_purchase_from_client') {
    await rejectClientSidePurchaseConfirmation();
  }
  if (command === 'quote_staff_seat_purchase') return quoteStaffSeatPurchaseCommand(ctx, orgId, payload);
  if (command === 'create_staff_seat_purchase_intent') return createStaffSeatPurchaseIntentCommand(ctx, orgId, payload);
  if (command === 'cancel_staff_seat_purchase_intent') return cancelStaffSeatPurchaseIntentCommand(ctx, orgId, payload);
  throw badRequest('Unknown command', 'UNKNOWN_COMMAND');
}
