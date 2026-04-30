import { supabaseAdmin } from '../../db/client.js';
import { forbidden, badRequest } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { resolveEntitlement } from './entitlement.service.js';
import { getDependencyModuleIds, getMissingActiveDependencies } from './dependency.service.js';
import { runModuleActivateHook, runModuleDeactivateHook } from './init-hooks.js';
import { hasValidTrial, hasExpiredTrial } from '../trial/trial.service.js';

export async function activateModule(
  ctx: RequestContext,
  organizationId: string,
  moduleId: string
): Promise<{ success: boolean; blockReason?: string }> {
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
      payload: { action: 'activate' },
    });
    return { success: true };
  }

  const entitlement = await resolveEntitlement(organizationId, moduleId);
  if (entitlement.status !== 'entitled' && entitlement.status !== 'trial') {
    await writeAudit({
      organizationId,
      actorUserId: ctx.user.id,
      moduleCode: mod.data.code,
      entityType: 'module',
      action: AUDIT_ACTIONS.MODULE_ENTITLEMENT_CHECK_FAILED,
      payload: { moduleCode: mod.data.code, reason: entitlement.reason },
    });
    const expiredTrial = await hasExpiredTrial(organizationId);
    if (expiredTrial) {
      await writeAudit({
        organizationId,
        actorUserId: ctx.user.id,
        moduleCode: mod.data.code,
        entityType: 'module',
        action: AUDIT_ACTIONS.MODULE_ACCESS_DENIED_AFTER_TRIAL,
        payload: {},
      });
    }
    return { success: false, blockReason: entitlement.reason ?? 'Not entitled' };
  }

  const depIds = await getDependencyModuleIds(moduleId);
  const missing = await getMissingActiveDependencies(organizationId, depIds);
  if (missing.length > 0) {
    await writeAudit({
      organizationId,
      actorUserId: ctx.user.id,
      moduleCode: mod.data.code,
      entityType: 'module',
      action: AUDIT_ACTIONS.MODULE_DEPENDENCY_CHECK_FAILED,
      payload: { moduleCode: mod.data.code, missingDependencies: missing },
    });
    return { success: false, blockReason: `Missing dependencies: ${missing.join(', ')}` };
  }

  const existing = await supabaseAdmin
    .from('organization_modules')
    .select('id, status')
    .eq('organization_id', organizationId)
    .eq('module_id', moduleId)
    .single();

  if (existing.data?.status === 'active') {
    return { success: true };
  }

  const moduleSub = await supabaseAdmin
    .from('organization_module_subscriptions')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('module_id', moduleId)
    .in('status', ['active', 'trialing'])
    .single();

  const validTrial = await hasValidTrial(organizationId);
  if (!moduleSub.data && !validTrial) {
    await writeAudit({
      organizationId,
      actorUserId: ctx.user.id,
      moduleCode: mod.data.code,
      entityType: 'module',
      action: AUDIT_ACTIONS.MODULE_ACTIVATION_BLOCKED,
      payload: { reason: 'No active module subscription or trial' },
    });
    const expiredTrial = await hasExpiredTrial(organizationId);
    if (expiredTrial) {
      await writeAudit({
        organizationId,
        actorUserId: ctx.user.id,
        moduleCode: mod.data.code,
        entityType: 'module',
        action: AUDIT_ACTIONS.MODULE_ACCESS_DENIED_AFTER_TRIAL,
        payload: {},
      });
    }
    return { success: false, blockReason: 'Select a plan first or use during trial' };
  }

  const initResult = await runModuleActivateHook({
    organizationId,
    moduleId,
    moduleCode: mod.data.code,
  });
  await writeAudit({
    organizationId,
    actorUserId: ctx.user.id,
    moduleCode: mod.data.code,
    entityType: 'module',
    action: AUDIT_ACTIONS.MODULE_INIT_RUN,
    payload: { organizationId, moduleId, success: initResult.success, error: initResult.error },
  });

  const subscriptionId = moduleSub.data?.id ?? null;
  if (!subscriptionId && validTrial) {
    await writeAudit({
      organizationId,
      actorUserId: ctx.user.id,
      moduleCode: mod.data.code,
      entityType: 'module',
      action: AUDIT_ACTIONS.MODULE_ACCESS_VIA_TRIAL,
      payload: {},
    });
  }
  if (existing.data) {
    await supabaseAdmin
      .from('organization_modules')
      .update({
        status: 'active',
        deactivated_at: null,
        organization_module_subscription_id: subscriptionId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.data.id);
  } else {
    await supabaseAdmin.from('organization_modules').insert({
      organization_id: organizationId,
      module_id: moduleId,
      status: 'active',
      activated_at: new Date().toISOString(),
      organization_module_subscription_id: subscriptionId,
    });
  }

  await writeAudit({
    organizationId,
    actorUserId: ctx.user.id,
    moduleCode: mod.data.code,
    entityType: 'module',
    entityId: moduleId,
    action: AUDIT_ACTIONS.MODULE_ACTIVATED,
    payload: {},
  });

  return { success: true };
}

export async function deactivateModule(
  ctx: RequestContext,
  organizationId: string,
  moduleId: string
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
      payload: { action: 'deactivate' },
    });
    throw forbidden('System modules cannot be deactivated');
  }

  const { data: om } = await supabaseAdmin
    .from('organization_modules')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('module_id', moduleId)
    .single();

  if (om) {
    await supabaseAdmin
      .from('organization_modules')
      .update({ status: 'deactivated', deactivated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', om.id);

    const deinitResult = await runModuleDeactivateHook({
      organizationId,
      moduleId,
      moduleCode: mod.data.code,
    });
    if (!deinitResult.success) {
      await writeAudit({
        organizationId,
        actorUserId: ctx.user.id,
        moduleCode: mod.data.code,
        entityType: 'module',
        action: AUDIT_ACTIONS.MODULE_INIT_RUN,
        payload: { phase: 'deactivate', success: false, error: deinitResult.error },
      });
    }
  }

  await writeAudit({
    organizationId,
    actorUserId: ctx.user.id,
    moduleCode: mod.data.code,
    entityType: 'module',
    entityId: moduleId,
    action: AUDIT_ACTIONS.MODULE_DEACTIVATED,
    payload: {},
  });
}
