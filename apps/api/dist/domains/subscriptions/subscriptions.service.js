import { supabaseAdmin } from '../../db/client.js';
import { forbidden } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
/**
 * Legacy: returns the organization's row from the platform-wide `subscriptions` table.
 * Not used for module entitlement or module billing. Module entitlement is resolved only from
 * organization_module_subscriptions (see entitlement.service, docs/architecture/commerce-module-based/02-legacy-plans-deprecation.md).
 */
export async function getCurrentSubscription(ctx, orgId) {
    if (ctx.organizationId !== orgId)
        throw forbidden('Organization context required');
    const { data } = await supabaseAdmin.from('subscriptions').select('*').eq('organization_id', orgId).order('started_at', { ascending: false }).limit(1).single();
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'subscription',
        action: AUDIT_ACTIONS.SUBSCRIPTION_VIEWED,
        payload: {},
    });
    return data;
}
