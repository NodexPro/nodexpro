import crypto from 'crypto';
import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, conflict, forbidden } from '../../shared/errors.js';
import { RBAC_PERMISSIONS, requireRbacPermission } from '../rbac/rbac.service.js';
import { resolveIncomeDraftVatForOrg } from '../income/income-draft-vat-resolver.js';
import { incomeDraftVatFallbackResolution } from '../income/income-draft-vat-fallback.pure.js';
import { buildModulePurchaseQuote, canActivateModulePurchase } from './module-purchase.pure.js';

function assertModuleWriter(ctx: RequestContext, orgId: string) {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
  requireRbacPermission(ctx, orgId, RBAC_PERMISSIONS.access_billing);
}

async function quoteForPlan(orgId: string, moduleId: string, modulePlanId: string) {
  const asOfDate = new Date().toISOString().slice(0, 10);
  const [{ data: plan, error }, vat] = await Promise.all([
    supabaseAdmin
      .from('module_plans')
      .select('id, module_id, billing_period, currency, price_amount, is_active')
      .eq('id', modulePlanId)
      .eq('module_id', moduleId)
      .maybeSingle(),
    resolveIncomeDraftVatForOrg(orgId, 'IL', asOfDate).catch(() => incomeDraftVatFallbackResolution()),
  ]);
  if (error) throw error;
  if (!plan || plan.is_active === false) throw badRequest('Plan not found', 'MODULE_PLAN_NOT_FOUND');
  const vatAuthoritative = vat.source === 'country_pack';
  return buildModulePurchaseQuote({
    moduleId,
    modulePlanId,
    unitPriceNet: Number(plan.price_amount) || 0,
    currency: String(plan.currency ?? 'ILS'),
    billingPeriod: String(plan.billing_period ?? 'month'),
    vatRate: vat.standard_rate,
    vatPercentLabel: vat.standard_rate_percent_label,
    vatAuthoritative,
  });
}

export async function quoteModulePurchaseCommand(
  ctx: RequestContext,
  orgId: string,
  payload: Record<string, unknown>,
) {
  assertModuleWriter(ctx, orgId);
  const moduleId = String(payload.module_id ?? '').trim();
  const modulePlanId = String(payload.module_plan_id ?? '').trim();
  if (!moduleId || !modulePlanId) throw badRequest('module_id and module_plan_id required');
  const quote = await quoteForPlan(orgId, moduleId, modulePlanId);
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'module_purchase_intent',
    action: AUDIT_ACTIONS.MODULE_PURCHASE_QUOTED,
    payload: { module_id: moduleId, module_plan_id: modulePlanId, checkout_available: false },
  });
  return {
    ok: true as const,
    command: 'quote_module_purchase' as const,
    quote,
  };
}

export async function createModulePurchaseIntentCommand(
  ctx: RequestContext,
  orgId: string,
  payload: Record<string, unknown>,
) {
  assertModuleWriter(ctx, orgId);
  const moduleId = String(payload.module_id ?? '').trim();
  const modulePlanId = String(payload.module_plan_id ?? '').trim();
  if (!moduleId || !modulePlanId) throw badRequest('module_id and module_plan_id required');
  const quote = await quoteForPlan(orgId, moduleId, modulePlanId);
  const { data: open } = await supabaseAdmin
    .from('module_purchase_intents')
    .select('id, status')
    .eq('organization_id', orgId)
    .eq('module_id', moduleId)
    .in('status', ['quoted', 'pending_payment'])
    .maybeSingle();
  if (open) {
    return {
      ok: true as const,
      command: 'create_module_purchase_intent' as const,
      intent: { id: open.id, status: open.status, checkout_url: null, checkout_available: false },
      quote,
    };
  }
  const idempotencyKey =
    String(payload.idempotency_key ?? '').trim() || `module:${orgId}:${moduleId}:${modulePlanId}:${crypto.randomUUID()}`;
  const { data, error } = await supabaseAdmin
    .from('module_purchase_intents')
    .insert({
      organization_id: orgId,
      module_id: moduleId,
      module_plan_id: modulePlanId,
      currency: quote.currency,
      unit_price_net: quote.unit_price_net,
      net_amount: quote.net_amount,
      vat_rate: quote.vat_rate,
      vat_amount: quote.vat_amount,
      total_amount: quote.total_amount,
      vat_authoritative: quote.vat_authoritative,
      billing_period: quote.billing_period,
      status: 'quoted',
      idempotency_key: idempotencyKey,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by_user_id: ctx.user.id,
    })
    .select('id, status')
    .maybeSingle();
  if (error) throw error;
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'module_purchase_intent',
    entityId: data?.id ?? null,
    action: AUDIT_ACTIONS.MODULE_PURCHASE_INTENT_CREATED,
    payload: { module_id: moduleId, status: 'quoted', checkout_available: false },
  });
  return {
    ok: true as const,
    command: 'create_module_purchase_intent' as const,
    intent: { id: data?.id ?? null, status: 'quoted', checkout_url: null, checkout_available: false },
    quote,
  };
}

export async function cancelModulePurchaseIntentCommand(
  ctx: RequestContext,
  orgId: string,
  payload: Record<string, unknown>,
) {
  assertModuleWriter(ctx, orgId);
  const intentId = String(payload.intent_id ?? '').trim();
  if (!intentId) throw badRequest('intent_id required');
  const { data: row, error } = await supabaseAdmin
    .from('module_purchase_intents')
    .select('id, status')
    .eq('id', intentId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw badRequest('Intent not found', 'MODULE_PURCHASE_NOT_FOUND');
  if (row.status === 'activated') throw conflict('Activated purchases cannot be cancelled', 'MODULE_PURCHASE_ALREADY_ACTIVATED');
  await supabaseAdmin
    .from('module_purchase_intents')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', intentId)
    .eq('organization_id', orgId)
    .in('status', ['quoted', 'pending_payment']);
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'module_purchase_intent',
    entityId: intentId,
    action: AUDIT_ACTIONS.MODULE_PURCHASE_INTENT_CANCELLED,
    payload: { previous_status: row.status },
  });
  return {
    ok: true as const,
    command: 'cancel_module_purchase_intent' as const,
  };
}

export async function activateModulePurchaseFromVerifiedPayment(input: {
  organizationId: string;
  intentId: string;
  paymentTransactionId: string;
  actorUserId: string | null;
}) {
  const { data: intent, error } = await supabaseAdmin
    .from('module_purchase_intents')
    .select('*')
    .eq('id', input.intentId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!intent) throw badRequest('Intent not found', 'MODULE_PURCHASE_NOT_FOUND');
  const gate = canActivateModulePurchase({
    intentStatus: String(intent.status),
    paymentVerified: Boolean(input.paymentTransactionId),
    alreadyActivated: Boolean(intent.activated_at) || intent.status === 'activated',
  });
  if (!gate.ok) {
    await writeAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      entityType: 'module_purchase_intent',
      entityId: input.intentId,
      action: AUDIT_ACTIONS.MODULE_PURCHASE_ACTIVATION_BLOCKED,
      payload: { code: gate.code },
    });
    throw conflict('Module purchase cannot be activated', gate.code);
  }
  const { data: payment } = await supabaseAdmin
    .from('payment_transactions')
    .select('id, status, seller_context, amount, currency, organization_id')
    .eq('id', input.paymentTransactionId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (
    !payment ||
    payment.status !== 'verified' ||
    payment.seller_context !== 'nodexpro_platform' ||
    Number(payment.amount) !== Number(intent.total_amount) ||
    payment.currency !== intent.currency
  ) {
    throw conflict('Verified platform payment required', 'NOT_PAID');
  }
  const existing = await supabaseAdmin
    .from('organization_module_subscriptions')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('module_id', intent.module_id)
    .maybeSingle();
  if (existing.data) {
    await supabaseAdmin
      .from('organization_module_subscriptions')
      .update({ module_plan_id: intent.module_plan_id, status: 'active', updated_at: new Date().toISOString() })
      .eq('id', existing.data.id);
  } else {
    await supabaseAdmin.from('organization_module_subscriptions').insert({
      organization_id: input.organizationId,
      module_id: intent.module_id,
      module_plan_id: intent.module_plan_id,
      status: 'active',
    });
  }
  const { data: updated } = await supabaseAdmin
    .from('module_purchase_intents')
    .update({
      status: 'activated',
      payment_transaction_id: input.paymentTransactionId,
      activated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.intentId)
    .neq('status', 'activated')
    .select('id')
    .maybeSingle();
  if (!updated) throw conflict('Purchase already activated', 'MODULE_PURCHASE_ALREADY_ACTIVATED');
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    entityType: 'module_purchase_intent',
    entityId: input.intentId,
    action: AUDIT_ACTIONS.MODULE_PURCHASE_CONFIRMED,
    payload: { payment_transaction_id: input.paymentTransactionId },
  });
  return { ok: true as const, intent_id: input.intentId };
}

export function isModulePurchaseCommand(command: string): boolean {
  return (
    command === 'quote_module_purchase' ||
    command === 'create_module_purchase_intent' ||
    command === 'cancel_module_purchase_intent' ||
    command === 'confirm_module_purchase_from_client'
  );
}

export async function executeModulePurchaseCommand(
  ctx: RequestContext,
  orgId: string,
  command: string,
  payload: Record<string, unknown>,
) {
  if (command === 'confirm_module_purchase_from_client') {
    throw forbidden('Client redirect is not payment proof', 'PAYMENT_CLIENT_REDIRECT_REJECTED');
  }
  if (command === 'quote_module_purchase') return quoteModulePurchaseCommand(ctx, orgId, payload);
  if (command === 'create_module_purchase_intent') return createModulePurchaseIntentCommand(ctx, orgId, payload);
  if (command === 'cancel_module_purchase_intent') return cancelModulePurchaseIntentCommand(ctx, orgId, payload);
  throw badRequest('Unknown command', 'UNKNOWN_COMMAND');
}
