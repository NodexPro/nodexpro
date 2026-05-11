import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import type { RequestContext } from '../shared/context.js';
import { badRequest } from '../shared/errors.js';
import { assertPlatformOwner } from '../shared/platform-owner.js';
import { AUDIT_ACTIONS, writeAudit } from '../shared/audit-events.js';
import { executeCountryPackCommand } from '../domains/country-pack/country-pack-commands.service.js';
import {
  buildActiveRulesetContextAggregate,
  buildCountryPackDiagnosticsAggregate,
  buildOrganizationCountrySettingsAggregate,
  buildOwnerCountryPackAdminAggregate,
  buildOwnerLegalControlPanelAggregate,
  buildOwnerLegalValuesAggregate,
  buildOwnerPlatformPricingAggregate,
} from '../domains/country-pack/country-pack-read-models.service.js';
import { buildOwnerEmailProviderConfigAggregate } from '../shared/owner-email-provider-config.service.js';

const router = Router();

async function assertOwnerOrAuditFailure(ctx: RequestContext, req: Request): Promise<void> {
  try {
    assertPlatformOwner(ctx);
  } catch (error) {
    await writeAudit({
      organizationId: null,
      actorUserId: ctx.user.id,
      entityType: 'owner_country_pack_api',
      action: AUDIT_ACTIONS.OWNER_SECURITY_CHECK_FAILED,
      payload: {
        method: req.method,
        path: req.path,
        reason: error instanceof Error ? error.message : 'platform_owner_guard_failed',
      },
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    throw error;
  }
}

/** Read model: current session is allowed platform owner (backend decision only). */
router.get('/session', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    return res.json({
      aggregate_key: 'platform_owner_session_aggregate',
      allowed: true,
    });
  } catch (e) {
    next(e);
  }
});

router.use(authMiddleware);

router.get('/legal-control', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    const aggregate = await buildOwnerLegalControlPanelAggregate(ctx, {
      commercial_controls: {
        page: Number(req.query.commercial_page ?? 1) || 1,
        page_size: Number(req.query.commercial_page_size ?? 20) || 20,
        search: typeof req.query.commercial_search === 'string' ? req.query.commercial_search : null,
        module_key: typeof req.query.commercial_module_key === 'string' ? req.query.commercial_module_key : null,
        entitlement_status: typeof req.query.commercial_entitlement_status === 'string' ? req.query.commercial_entitlement_status : null,
        activation_status: typeof req.query.commercial_activation_status === 'string' ? req.query.commercial_activation_status : null,
      },
    });
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

router.get('/country-packs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    const aggregate = await buildOwnerCountryPackAdminAggregate(ctx);
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

router.get('/legal-values', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    const aggregate = await buildOwnerLegalValuesAggregate(ctx);
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

router.get('/pricing', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    const aggregate = await buildOwnerPlatformPricingAggregate(ctx);
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

router.get('/email-provider-config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    const aggregate = await buildOwnerEmailProviderConfigAggregate();
    return res.json({
      aggregate_key: 'owner_email_provider_config_aggregate',
      ...aggregate,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/country-settings/:organizationId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    const organizationId = String(req.params.organizationId ?? '');
    if (!organizationId) throw badRequest('organizationId is required');
    const aggregate = await buildOrganizationCountrySettingsAggregate(ctx, organizationId);
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

router.get('/country-diagnostics/:organizationId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    const organizationId = String(req.params.organizationId ?? '');
    if (!organizationId) throw badRequest('organizationId is required');
    const aggregate = await buildCountryPackDiagnosticsAggregate(ctx, organizationId);
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

// Internal resolver aggregate exposure for owner diagnostics.
router.get('/active-ruleset-context/:organizationId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    const organizationId = String(req.params.organizationId ?? '');
    if (!organizationId) throw badRequest('organizationId is required');
    const dateRaw = typeof req.query.date === 'string' ? req.query.date.trim() : '';
    const date = dateRaw || new Date().toISOString().slice(0, 10);
    const aggregate = await buildActiveRulesetContextAggregate(ctx, organizationId, date);
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

router.post('/command', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);

    const commandName = typeof req.body?.command === 'string' ? req.body.command.trim() : '';
    const payload = req.body?.payload;
    if (!commandName) throw badRequest('command is required');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw badRequest('payload must be an object');
    }

    const out = await executeCountryPackCommand(ctx, {
      command: commandName as never,
      payload: payload as Record<string, unknown>,
    });
    return res.json(out);
  } catch (e) {
    next(e);
  }
});

export const ownerCountryPackRoutes = router;

