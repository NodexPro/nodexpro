import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../db/client.js';
import { forbidden } from '../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../shared/audit-events.js';
import { resolveEntitlement } from '../domains/modules/entitlement.service.js';
import {
  assertStaffViewerMayUseModule,
  prefetchStaffViewerModuleGrant,
} from '../domains/modules/member-module-access.service.js';
import { resolveModuleEntitlementCode } from '../shared/module-entitlement.pure.js';

export function requireModuleActive(moduleCode: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const entitlementModuleCode = resolveModuleEntitlementCode(moduleCode);
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

    // Staff/Viewer grant reads do not depend on the module row (the module id is only compared afterwards), so they
    // start now and overlap the module read. null for Owner/Admin. LIVE reads, never cached; they are consumed
    // below, after entitlement, exactly where the grant check always ran.
    const staffGrantPrefetch = prefetchStaffViewerModuleGrant(ctx);

    const { data: mod } = await supabaseAdmin
      .from('modules')
      .select('id, code, is_active, is_system')
      .eq('code', entitlementModuleCode)
      .single();
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

    if (!(mod as { is_active?: boolean }).is_active) {
      console.warn('[docflow][deny] requireModuleActive: module globally inactive', {
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
        payload: { reason: 'Module is globally disabled (modules.is_active=false)' },
      });
      next(forbidden('Module is globally disabled'));
      return;
    }

    // The remaining checks are independent LIVE reads that only need the module id. They are started together
    // (one network round trip instead of up to four in a row) and EVALUATED below in the original order, so every
    // decision, deny reason, audit entry and error precedence is unchanged. Nothing is cached.
    // (Query builders are lazy thenables: Promise.resolve() is what actually starts the request here.)
    const organizationModuleRead = Promise.resolve(
      supabaseAdmin
        .from('organization_modules')
        .select('id')
        .eq('organization_id', ctx.organizationId)
        .eq('module_id', mod.id)
        .eq('status', 'active')
        .single(),
    );
    const entitlementRead = resolveEntitlement(ctx.organizationId, mod.id, {
      id: String(mod.id),
      is_system: (mod as { is_system?: boolean | null }).is_system ?? false,
    });
    // Only a denial that returns before a read is awaited could leave it unobserved; never an unhandled rejection.
    organizationModuleRead.catch(() => undefined);
    entitlementRead.catch(() => undefined);

    const { data: om } = await organizationModuleRead;

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

    const entitlement = await entitlementRead;
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

    // Staff/Viewer: organization entitlement is not member access.
    // Runs before module handlers and their caches, so a removed grant
    // cannot reuse a previous response.
    try {
      await assertStaffViewerMayUseModule(ctx, String(mod.id), staffGrantPrefetch);
    } catch (e) {
      next(e);
      return;
    }

    next();
  };
}
