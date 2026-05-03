import { supabaseAdmin } from '../db/client.js';
import { forbidden } from '../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../shared/audit-events.js';
import { resolveEntitlement } from '../domains/modules/entitlement.service.js';
export function requireModuleActive(moduleCode) {
    return async (req, _res, next) => {
        const ctx = req.context;
        const email = (ctx?.user?.email ?? '').trim().toLowerCase();
        if (!ctx?.organizationId) {
            console.warn('[docflow][deny] requireModuleActive: missing organization context', {
                module: moduleCode,
                user_email: email || null,
                user_id: ctx?.user?.id ?? null,
            });
            next(forbidden('Organization context required'));
            return;
        }
        const { data: mod } = await supabaseAdmin.from('modules').select('id, code').eq('code', moduleCode).single();
        if (!mod) {
            console.warn('[docflow][deny] requireModuleActive: module not found', {
                module: moduleCode,
                user_email: email || null,
                user_id: ctx.user.id,
                org_id: ctx.organizationId,
            });
            next(forbidden('Module not found'));
            return;
        }
        const { data: om } = await supabaseAdmin
            .from('organization_modules')
            .select('id')
            .eq('organization_id', ctx.organizationId)
            .eq('module_id', mod.id)
            .eq('status', 'active')
            .single();
        if (!om) {
            console.warn('[docflow][deny] requireModuleActive: module not active', {
                module: moduleCode,
                user_email: email || null,
                user_id: ctx.user.id,
                org_id: ctx.organizationId,
            });
            await writeAudit({
                organizationId: ctx.organizationId,
                actorUserId: ctx.user.id,
                moduleCode: mod.code,
                entityType: 'module',
                action: AUDIT_ACTIONS.MODULE_ACCESS_DENIED,
                payload: { reason: 'Module not active for organization' },
            });
            next(forbidden('Module not active for this organization'));
            return;
        }
        const entitlement = await resolveEntitlement(ctx.organizationId, mod.id);
        if (entitlement.status !== 'entitled' && entitlement.status !== 'trial') {
            console.warn('[docflow][deny] requireModuleActive: not entitled', {
                module: moduleCode,
                user_email: email || null,
                user_id: ctx.user.id,
                org_id: ctx.organizationId,
                entitlement_status: entitlement.status,
                entitlement_reason: entitlement.reason ?? null,
            });
            await writeAudit({
                organizationId: ctx.organizationId,
                actorUserId: ctx.user.id,
                moduleCode: mod.code,
                entityType: 'module',
                action: AUDIT_ACTIONS.MODULE_ACCESS_DENIED,
                payload: { reason: entitlement.reason ?? 'Not entitled to use this module' },
            });
            next(forbidden(entitlement.reason ?? 'Not entitled to use this module'));
            return;
        }
        next();
    };
}
