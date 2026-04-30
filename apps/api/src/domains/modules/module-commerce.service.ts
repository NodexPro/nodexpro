import { supabaseAdmin } from '../../db/client.js';
import { forbidden, badRequest } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { supabaseEmbedOne } from '../../shared/supabase-embed.js';

export interface ModulePlanLimit {
  limitCode: string;
  limitValue: number | null;
  isUnlimited: boolean;
}

export interface ModulePlanDto {
  id: string;
  code: string;
  name: string;
  billingPeriod: string;
  currency: string;
  priceAmount: number;
  sortOrder: number;
  limits: ModulePlanLimit[];
}

export async function listPlansForModule(moduleId: string): Promise<ModulePlanDto[]> {
  const { data: plans } = await supabaseAdmin
    .from('module_plans')
    .select('id, code, name, billing_period, currency, price_amount, sort_order')
    .eq('module_id', moduleId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (!plans?.length) return [];

  const result: ModulePlanDto[] = [];
  for (const p of plans) {
    const { data: limits } = await supabaseAdmin
      .from('module_plan_limits')
      .select('limit_code, limit_value, is_unlimited')
      .eq('module_plan_id', p.id);
    result.push({
      id: p.id,
      code: p.code,
      name: p.name,
      billingPeriod: p.billing_period,
      currency: p.currency,
      priceAmount: Number(p.price_amount),
      sortOrder: p.sort_order ?? 0,
      limits: (limits ?? []).map((l: { limit_code: string; limit_value: number | null; is_unlimited: boolean }) => ({
        limitCode: l.limit_code,
        limitValue: l.limit_value != null ? Number(l.limit_value) : null,
        isUnlimited: l.is_unlimited,
      })),
    });
  }
  return result;
}

export async function getOrgModuleSubscription(
  organizationId: string,
  moduleId: string
): Promise<{
  id: string;
  modulePlanId: string;
  planName: string;
  currency: string;
  priceAmount: number;
  status: string;
  startedAt: string;
  endsAt: string | null;
} | null> {
  const { data: sub } = await supabaseAdmin
    .from('organization_module_subscriptions')
    .select('id, module_plan_id, status, started_at, ends_at, module_plans(name, currency, price_amount)')
    .eq('organization_id', organizationId)
    .eq('module_id', moduleId)
    .single();

  if (!sub) return null;
  const plan = supabaseEmbedOne(
    sub.module_plans as unknown as { name: string; currency: string; price_amount: number } | null
  );
  if (!plan) return null;
  return {
    id: sub.id,
    modulePlanId: sub.module_plan_id,
    planName: plan.name,
    currency: plan.currency,
    priceAmount: Number(plan.price_amount),
    status: sub.status,
    startedAt: sub.started_at,
    endsAt: sub.ends_at ?? null,
  };
}

/** Select plan: creates or replaces organization_module_subscription. Mock: status active. */
export async function selectPlan(
  ctx: RequestContext,
  organizationId: string,
  moduleId: string,
  modulePlanId: string
): Promise<void> {
  if (ctx.organizationId !== organizationId) throw forbidden('Organization context required');

  const mod = await supabaseAdmin.from('modules').select('id, code, is_system').eq('id', moduleId).single();
  if (!mod.data) throw badRequest('Module not found');
  if (mod.data.is_system) {
    await writeAudit({
      organizationId,
      actorUserId: ctx.user.id,
      moduleCode: mod.data.code,
      entityType: 'module',
      action: AUDIT_ACTIONS.SYSTEM_MODULE_PROTECTED,
      payload: { action: 'select_plan' },
    });
    throw badRequest('System modules do not have plans');
  }

  const plan = await supabaseAdmin.from('module_plans').select('id').eq('id', modulePlanId).eq('module_id', moduleId).single();
  if (!plan.data) throw badRequest('Invalid plan for this module');

  const existing = await supabaseAdmin
    .from('organization_module_subscriptions')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('module_id', moduleId)
    .single();

  if (existing.data) {
    await supabaseAdmin
      .from('organization_module_subscriptions')
      .update({ module_plan_id: modulePlanId, status: 'active', updated_at: new Date().toISOString() })
      .eq('id', existing.data.id);
    await writeAudit({
      organizationId,
      actorUserId: ctx.user.id,
      moduleCode: mod.data.code,
      entityType: 'module_subscription',
      entityId: existing.data.id,
      action: AUDIT_ACTIONS.MODULE_SUBSCRIPTION_CHANGED,
      payload: { modulePlanId },
    });
  } else {
    const { data: created } = await supabaseAdmin
      .from('organization_module_subscriptions')
      .insert({
        organization_id: organizationId,
        module_id: moduleId,
        module_plan_id: modulePlanId,
        status: 'active',
      })
      .select('id')
      .single();
    await writeAudit({
      organizationId,
      actorUserId: ctx.user.id,
      moduleCode: mod.data.code,
      entityType: 'module_subscription',
      entityId: created?.id,
      action: AUDIT_ACTIONS.MODULE_PLAN_SELECTED,
      payload: { modulePlanId },
    });
    await writeAudit({
      organizationId,
      actorUserId: ctx.user.id,
      moduleCode: mod.data.code,
      entityType: 'module_subscription',
      entityId: created?.id,
      action: AUDIT_ACTIONS.MODULE_SUBSCRIPTION_CREATED,
      payload: {},
    });
  }
}

/** Change plan: update existing organization_module_subscription. */
export async function changePlan(
  ctx: RequestContext,
  organizationId: string,
  moduleId: string,
  modulePlanId: string
): Promise<void> {
  if (ctx.organizationId !== organizationId) throw forbidden('Organization context required');

  const mod = await supabaseAdmin.from('modules').select('id, code, is_system').eq('id', moduleId).single();
  if (!mod.data) throw badRequest('Module not found');
  if (mod.data.is_system) throw badRequest('System modules do not have plans');

  const plan = await supabaseAdmin.from('module_plans').select('id').eq('id', modulePlanId).eq('module_id', moduleId).single();
  if (!plan.data) throw badRequest('Invalid plan for this module');

  const { data: sub } = await supabaseAdmin
    .from('organization_module_subscriptions')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('module_id', moduleId)
    .single();

  if (!sub) throw badRequest('No subscription to change');

  await supabaseAdmin
    .from('organization_module_subscriptions')
    .update({ module_plan_id: modulePlanId, updated_at: new Date().toISOString() })
    .eq('id', sub.id);

  await writeAudit({
    organizationId,
    actorUserId: ctx.user.id,
    moduleCode: mod.data.code,
    entityType: 'module_subscription',
    entityId: sub.id,
    action: AUDIT_ACTIONS.MODULE_SUBSCRIPTION_CHANGED,
    payload: { modulePlanId },
  });
}
