import { supabaseAdmin } from '../../db/client.js';
import { forbidden } from '../../shared/errors.js';
import type { RequestContext } from '../../shared/context.js';
import type { ModuleStateItem, ModulesStateResponse, EntitlementStatus, ActivationStatus } from '../../types/api.js';
import { getTrialState } from '../trial/trial.service.js';
import { supabaseEmbedOne } from '../../shared/supabase-embed.js';

const LOG_MODULES_STATE_TIMING = process.env.LOG_MODULES_STATE_TIMING === 'true';

export async function getModulesState(ctx: RequestContext, organizationId: string): Promise<ModulesStateResponse> {
  const startMs = LOG_MODULES_STATE_TIMING ? Date.now() : 0;

  if (ctx.organizationId !== organizationId) throw forbidden('Organization context required');

  const moduleIds: string[] = [];
  const commercialModuleIds: string[] = [];

  const [
    modulesRes,
    orgModsRes,
    trialState,
    subsRes,
    depsRes,
  ] = await Promise.all([
    supabaseAdmin
      .from('modules')
      .select('id, code, name, version, scope_type, category, nav_path, nav_label, nav_order, is_system')
      .eq('is_active', true)
      .order('nav_order', { ascending: true }),
    supabaseAdmin
      .from('organization_modules')
      .select('module_id, status')
      .eq('organization_id', organizationId),
    getTrialState(organizationId),
    supabaseAdmin
      .from('organization_module_subscriptions')
      .select('id, module_id, module_plan_id, status, started_at, ends_at, module_plans(name, currency, price_amount)')
      .eq('organization_id', organizationId),
    supabaseAdmin
      .from('module_dependencies')
      .select('module_id, depends_on_module_id'),
  ]);

  const modules = modulesRes.data ?? [];
  if (!modules.length) {
    return { trialState: { hasLegalIdentity: trialState.hasLegalIdentity, trialStatus: trialState.trialStatus, startedAt: trialState.startedAt, endsAt: trialState.endsAt, blocked: trialState.blocked }, modules: [] };
  }

  for (const m of modules) {
    moduleIds.push(m.id);
    if (!(m as { is_system?: boolean }).is_system) commercialModuleIds.push(m.id);
  }

  const validTrialPromise = commercialModuleIds.length > 0
    ? supabaseAdmin
        .from('organization_trials')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('trial_scope', 'full_platform')
        .eq('status', 'trialing')
        .gt('ends_at', new Date().toISOString())
        .limit(1)
        .maybeSingle()
    : Promise.resolve({ data: null });

  const [validTrialRow, depCodeRows, plansRes] = await Promise.all([
    validTrialPromise,
    depsRes.data?.length
      ? supabaseAdmin.from('modules').select('id, code').in('id', [...new Set((depsRes.data as { depends_on_module_id: string }[]).map((d) => d.depends_on_module_id))])
      : Promise.resolve({ data: [] }),
    commercialModuleIds.length > 0
      ? supabaseAdmin
          .from('module_plans')
          .select('id, module_id, code, name, billing_period, currency, price_amount, sort_order')
          .in('module_id', commercialModuleIds)
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  const planIds = (plansRes.data ?? []).map((p: { id: string }) => p.id);
  const limitsRes = planIds.length > 0
    ? await supabaseAdmin
        .from('module_plan_limits')
        .select('module_plan_id, limit_code, limit_value, is_unlimited')
        .in('module_plan_id', planIds)
    : { data: [] };

  const t1 = LOG_MODULES_STATE_TIMING ? Date.now() - startMs : 0;

  const activationByModule = new Map<string, string>(
    (orgModsRes.data ?? []).map((r: { module_id: string; status: string }) => [r.module_id, r.status])
  );
  const validTrial = !!validTrialRow.data;

  const subsByModule = new Map<string, { id: string; modulePlanId: string; planName: string; currency: string; priceAmount: number; status: string; startedAt: string; endsAt: string | null }>();
  for (const row of subsRes.data ?? []) {
    const r = row as unknown as {
      module_id: string;
      id: string;
      module_plan_id: string;
      status: string;
      started_at: string;
      ends_at: string | null;
      module_plans: { name: string; currency: string; price_amount: number } | null;
    };
    const plan = supabaseEmbedOne(r.module_plans);
    if (!plan) continue;
    subsByModule.set(r.module_id, {
      id: r.id,
      modulePlanId: r.module_plan_id,
      planName: plan.name,
      currency: plan.currency,
      priceAmount: Number(plan.price_amount),
      status: r.status,
      startedAt: r.started_at,
      endsAt: r.ends_at ?? null,
    });
  }

  const depIdToCode = new Map<string, string>();
  for (const row of depCodeRows.data ?? []) {
    const r = row as { id: string; code: string };
    depIdToCode.set(r.id, r.code);
  }
  const depsByModule = new Map<string, { depIds: string[]; depCodes: string[] }>();
  for (const row of depsRes.data ?? []) {
    const r = row as { module_id: string; depends_on_module_id: string };
    const existing = depsByModule.get(r.module_id) ?? { depIds: [], depCodes: [] };
    existing.depIds.push(r.depends_on_module_id);
    const code = depIdToCode.get(r.depends_on_module_id);
    if (code) existing.depCodes.push(code);
    depsByModule.set(r.module_id, existing);
  }

  const activeModuleIds = new Set(
    (orgModsRes.data ?? [])
      .filter((r: { status: string }) => r.status === 'active')
      .map((r: { module_id: string }) => r.module_id)
  );

  const limitsByPlanId = new Map<string, { limitCode: string; limitValue: number | null; isUnlimited: boolean }[]>();
  for (const row of limitsRes.data ?? []) {
    const r = row as { module_plan_id: string; limit_code: string; limit_value: number | null; is_unlimited: boolean };
    const list = limitsByPlanId.get(r.module_plan_id) ?? [];
    list.push({ limitCode: r.limit_code, limitValue: r.limit_value != null ? Number(r.limit_value) : null, isUnlimited: r.is_unlimited });
    limitsByPlanId.set(r.module_plan_id, list);
  }

  const plansByModule = new Map<string, { id: string; code: string; name: string; billingPeriod: string; currency: string; priceAmount: number; sortOrder: number; limits: { limitCode: string; limitValue: number | null; isUnlimited: boolean }[] }[]>();
  for (const p of plansRes.data ?? []) {
    const plan = p as { id: string; module_id: string; code: string; name: string; billing_period: string; currency: string; price_amount: number; sort_order: number };
    const limits = limitsByPlanId.get(plan.id) ?? [];
    const list = plansByModule.get(plan.module_id) ?? [];
    list.push({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      billingPeriod: plan.billing_period,
      currency: plan.currency,
      priceAmount: Number(plan.price_amount),
      sortOrder: plan.sort_order ?? 0,
      limits,
    });
    plansByModule.set(plan.module_id, list);
  }

  const result: ModuleStateItem[] = [];

  for (const m of modules) {
    const isSystem = Boolean((m as { is_system?: boolean }).is_system);
    const activationStatus: ActivationStatus = isSystem
      ? 'active'
      : ((activationByModule.get(m.id) as ActivationStatus) ?? 'inactive');

    let entitlementStatus: EntitlementStatus = 'not_entitled';
    let entitlementReason: string | undefined;
    if (isSystem) {
      entitlementStatus = 'entitled';
    } else {
      const sub = subsByModule.get(m.id);
      if (sub) {
        if (sub.status === 'active' || sub.status === 'trialing') {
          if (sub.endsAt && new Date(sub.endsAt) < new Date()) {
            entitlementStatus = 'expired';
            entitlementReason = 'Subscription ended';
          } else {
            entitlementStatus = sub.status === 'trialing' ? 'trial' : 'entitled';
          }
        } else {
          entitlementStatus = 'expired';
          entitlementReason = `Subscription status: ${sub.status}`;
        }
      } else if (validTrial) {
        entitlementStatus = 'trial';
      } else {
        entitlementReason = 'No subscription or trial for this module';
      }
    }

    const { depIds = [], depCodes = [] } = depsByModule.get(m.id) ?? {};
    const missingDepIds = depIds.filter((id) => !activeModuleIds.has(id));
    const missingDeps = missingDepIds.map((id) => depIdToCode.get(id)).filter(Boolean) as string[];

    const canActivate =
      !isSystem &&
      activationStatus !== 'active' &&
      (entitlementStatus === 'entitled' || entitlementStatus === 'trial') &&
      missingDeps.length === 0;
    const canDeactivate = !isSystem && activationStatus === 'active';
    let blockReason: string | null = null;
    if (activationStatus === 'inactive' && !canActivate && !isSystem) {
      if (entitlementStatus !== 'entitled' && entitlementStatus !== 'trial') blockReason = entitlementReason ?? 'Not entitled';
      else if (missingDeps.length > 0) blockReason = `Missing dependencies: ${missingDeps.join(', ')}`;
    }

    const availablePlans = isSystem ? [] : (plansByModule.get(m.id) ?? []).map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      billingPeriod: p.billingPeriod,
      currency: p.currency,
      priceAmount: p.priceAmount,
      sortOrder: p.sortOrder,
      limits: p.limits.map((l) => ({ limitCode: l.limitCode, limitValue: l.limitValue, isUnlimited: l.isUnlimited })),
    }));
    const currentSubscription = isSystem ? null : subsByModule.get(m.id) ?? null;
    const hasActiveSub = currentSubscription && (currentSubscription.status === 'active' || currentSubscription.status === 'trialing');
    const canSelectPlan = !isSystem && !hasActiveSub && availablePlans.length > 0;
    const canChangePlan = !isSystem && !!hasActiveSub && availablePlans.length > 1;

    result.push({
      moduleId: m.id,
      code: m.code,
      name: m.name,
      version: m.version ?? '1.0.0',
      scopeType: m.scope_type,
      category: m.category ?? null,
      dependencies: depCodes,
      entitlementStatus: entitlementStatus as EntitlementStatus,
      activationStatus,
      canActivate,
      canDeactivate,
      blockReason,
      navPath: m.nav_path ?? null,
      navLabel: m.nav_label ?? null,
      navOrder: m.nav_order ?? 0,
      isSystem,
      availablePlans,
      currentSubscription: currentSubscription
        ? {
            id: currentSubscription.id,
            modulePlanId: currentSubscription.modulePlanId,
            planName: currentSubscription.planName,
            currency: currentSubscription.currency,
            priceAmount: currentSubscription.priceAmount,
            status: currentSubscription.status,
            startedAt: currentSubscription.startedAt,
            endsAt: currentSubscription.endsAt,
          }
        : null,
      canSelectPlan,
      canChangePlan,
    });
  }

  if (LOG_MODULES_STATE_TIMING) {
    const totalMs = Date.now() - startMs;
    console.log(`[modules-state] getModulesState org=${organizationId} fetchMs=${t1} totalMs=${totalMs} modules=${result.length}`);
  }

  return {
    trialState: {
      hasLegalIdentity: trialState.hasLegalIdentity,
      trialStatus: trialState.trialStatus,
      startedAt: trialState.startedAt,
      endsAt: trialState.endsAt,
      blocked: trialState.blocked,
    },
    modules: result,
  };
}
