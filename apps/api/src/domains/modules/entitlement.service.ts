import { supabaseAdmin } from '../../db/client.js';
import type { EntitlementStatus } from '../../types/api.js';
import { hasValidTrial } from '../trial/trial.service.js';

/**
 * Per-module entitlement. System: always entitled. Commercial: (1) paid module subscription => entitled,
 * (2) valid org trial => trial, (3) else not_entitled/expired. No mixed logic with legacy plans.
 * See docs/architecture/commerce-module-based/02-legacy-plans-deprecation.md
 * and docs/architecture/trial-commerce/01-trial-commerce-implementation-package.md
 */
export async function resolveEntitlement(
  organizationId: string,
  moduleId: string
): Promise<{ status: EntitlementStatus; reason?: string }> {
  const mod = await supabaseAdmin.from('modules').select('id, is_system').eq('id', moduleId).single();
  if (!mod.data) return { status: 'not_entitled', reason: 'Module not found' };

  if (mod.data.is_system) {
    return { status: 'entitled' };
  }

  const sub = await supabaseAdmin
    .from('organization_module_subscriptions')
    .select('id, status, ends_at, trial_ends_at')
    .eq('organization_id', organizationId)
    .eq('module_id', moduleId)
    .single();

  if (sub.data) {
    const s = sub.data;
    if (s.status === 'active' || s.status === 'trialing') {
      if (s.ends_at && new Date(s.ends_at) < new Date()) {
        return { status: 'expired', reason: 'Subscription ended' };
      }
      if (s.status === 'trialing' && s.trial_ends_at && new Date(s.trial_ends_at) < new Date()) {
        return { status: 'expired', reason: 'Trial ended' };
      }
      if (s.status === 'trialing') return { status: 'trial' };
      return { status: 'entitled' };
    }
    return { status: 'expired', reason: `Subscription status: ${s.status}` };
  }

  const validTrial = await hasValidTrial(organizationId);
  if (validTrial) {
    return { status: 'trial' };
  }

  return { status: 'not_entitled', reason: 'No subscription or trial for this module' };
}

export async function resolveEntitlementsForOrganization(
  organizationId: string,
  moduleIds: string[]
): Promise<Map<string, { status: EntitlementStatus; reason?: string }>> {
  const map = new Map<string, { status: EntitlementStatus; reason?: string }>();
  await Promise.all(
    moduleIds.map(async (moduleId) => {
      const result = await resolveEntitlement(organizationId, moduleId);
      map.set(moduleId, result);
    })
  );
  return map;
}
