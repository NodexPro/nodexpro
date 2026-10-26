import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { config } from '../config.js';
import type { RequestContext } from '../shared/context.js';
import { badRequest, forbidden } from '../shared/errors.js';
import { assertPlatformOwner } from '../shared/platform-owner.js';
import { AUDIT_ACTIONS, writeAudit } from '../shared/audit-events.js';
import { processSecurityAlertDeliveries } from '../shared/security-alert-delivery.service.js';
import { recordSecurityEvent, securitySubjectKey } from '../shared/security-event.service.js';
import { ensureDbIpLiteDatabase } from '../shared/geoip-dbip.service.js';
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
import { buildOwnerSystemHealthAggregate } from '../domains/owner-system-health/owner-system-health.service.js';
import {
  buildOwnerSecurityEventsAggregate,
  clearOwnerSecurityJournal,
  deliverOwnerSecurityTestAlert,
  releaseOwnerSecurityContainment,
  type SecurityJournalQuery,
} from '../domains/owner-system-health/owner-security-events.service.js';
import { refreshPrivilegedMfaGate } from '../domains/auth/privileged-mfa.service.js';
import { activatePlatformOwnerMfa, verifyPlatformOwnerMfaRecovery } from '../domains/auth/platform-owner-mfa-activation.service.js';
import { getRequestCorrelationId } from '../middleware/correlation.js';
import {
  buildOwnerClientDetailAggregate,
  buildOwnerClientsListAggregate,
} from '../domains/owner-clients/owner-clients.service.js';
import {
  buildOwnerModuleDetailAggregate,
  buildOwnerModulesListAggregate,
} from '../domains/owner-modules/owner-modules.service.js';
import {
  buildOwnerInvoiceDocumentBuilderAggregate,
  executeOwnerInvoiceLayoutCommand,
  isOwnerInvoiceLayoutCommand,
} from '../domains/owner-invoice-document-layout/owner-invoice-document-layout.service.js';
import {
  buildOwnerCurrenciesAggregate,
  buildOwnerLanguagesAggregate,
  executePlatformLocalizationCommand,
  isPlatformLocalizationCommand,
} from '../domains/platform-localization/platform-localization.service.js';

const router = Router();

function requireInternalCronSecret(req: Request): void {
  const secret = String(req.headers['x-internal-cron-secret'] ?? '').trim();
  if (!config.internalCronSecret || !secret || secret !== config.internalCronSecret) {
    throw forbidden('Invalid internal cron secret');
  }
}

async function assertOwnerOrAuditFailure(ctx: RequestContext, req: Request): Promise<void> {
  await refreshPrivilegedMfaGate();
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
    await recordSecurityEvent({
      action: 'security.forbidden',
      dedupeKey: securitySubjectKey(`owner:${ctx.user.id}:${req.method}:${req.path}`),
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      correlationId: getRequestCorrelationId(req),
      sourceIp: req.trustedClientIp ?? (typeof req.ip === 'string' ? req.ip : null),
      payload: {
        http_status: 403,
        code: 'PLATFORM_OWNER_REQUIRED',
        kind: 'forbidden_privileged_operation',
      },
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

router.post('/internal/security-alert-deliveries/process', async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireInternalCronSecret(req);
    const limit = typeof req.body?.limit === 'number' ? req.body.limit : 20;
    const result = await processSecurityAlertDeliveries(limit);
    return res.json({
      ok: true,
      ...result,
      correlation_id: getRequestCorrelationId(req),
    });
  } catch (e) {
    next(e);
  }
});

router.post('/internal/geoip/update', async (req: Request, res: Response, next: NextFunction) => {
  try {
    requireInternalCronSecret(req);
    const force = req.body?.force === true;
    const result = await ensureDbIpLiteDatabase(force);
    return res.json({
      ok: true,
      ...result,
      correlation_id: getRequestCorrelationId(req),
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

router.get('/modules', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    const aggregate = await buildOwnerModulesListAggregate(ctx);
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

router.get('/modules/:moduleCode', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    const moduleCode = String(req.params.moduleCode ?? '').trim();
    if (!moduleCode) throw badRequest('moduleCode is required');
    const aggregate = await buildOwnerModuleDetailAggregate(ctx, moduleCode, {
      page: Number(req.query.commercial_page ?? 1) || 1,
      page_size: Number(req.query.commercial_page_size ?? 20) || 20,
      search: typeof req.query.commercial_search === 'string' ? req.query.commercial_search : null,
      module_key: moduleCode,
      entitlement_status:
        typeof req.query.commercial_entitlement_status === 'string' ? req.query.commercial_entitlement_status : null,
      activation_status:
        typeof req.query.commercial_activation_status === 'string' ? req.query.commercial_activation_status : null,
    }, {
      country_code: typeof req.query.calendar_country === 'string' ? req.query.calendar_country : 'IL',
      year: typeof req.query.calendar_year === 'string' ? req.query.calendar_year : undefined,
    });
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

router.get('/aggregates/security-events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    const token = req.headers.authorization?.slice(7) ?? '';
    const query: SecurityJournalQuery = {
      from: typeof req.query.from === 'string' ? req.query.from : null,
      to: typeof req.query.to === 'string' ? req.query.to : null,
      severity: typeof req.query.severity === 'string' ? req.query.severity : null,
      event: typeof req.query.event === 'string' ? req.query.event : null,
      ip: typeof req.query.ip === 'string' ? req.query.ip : null,
      identifier: typeof req.query.identifier === 'string' ? req.query.identifier : null,
      page: req.query.page ? Number(req.query.page) : 1,
    };
    return res.json(await buildOwnerSecurityEventsAggregate(ctx, token, query));
  } catch (e) {
    next(e);
  }
});

router.post('/commands/verify_platform_owner_mfa_recovery', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    const token = req.headers.authorization?.slice(7) ?? '';
    return res.json(await verifyPlatformOwnerMfaRecovery(ctx, token, req.body?.recovery_code));
  } catch (e) {
    next(e);
  }
});

router.post('/commands/activate_platform_owner_mfa', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    const token = req.headers.authorization?.slice(7) ?? '';
    return res.json(await activatePlatformOwnerMfa(ctx, token, req.body?.activation_request_id));
  } catch (e) {
    next(e);
  }
});

router.post(
  '/commands/deliver_security_test_alert',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    keyGenerator: (req) => req.context?.user.id ?? req.ip ?? 'unknown',
    code: 'SECURITY_TEST_ALERT_RATE_LIMIT',
    message: 'Too many security test alerts. Please try again later.',
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.context as RequestContext;
      await assertOwnerOrAuditFailure(ctx, req);
      const token = req.headers.authorization?.slice(7) ?? '';
      return res.json(await deliverOwnerSecurityTestAlert(ctx, getRequestCorrelationId(req), token));
    } catch (e) {
      next(e);
    }
  },
);

router.post('/commands/clear_security_journal', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    const token = req.headers.authorization?.slice(7) ?? '';
    return res.json(await clearOwnerSecurityJournal(ctx, token));
  } catch (e) {
    next(e);
  }
});

router.post('/commands/release_security_containment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    const token = req.headers.authorization?.slice(7) ?? '';
    return res.json(await releaseOwnerSecurityContainment(
      ctx,
      req.body?.incident_id,
      typeof req.body?.reason === 'string' ? req.body.reason : null,
      token,
    ));
  } catch (e) {
    next(e);
  }
});

router.get('/system-health', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    const asStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const aggregate = await buildOwnerSystemHealthAggregate(ctx, {
      severity: asStr(req.query.customer_severity),
      module: asStr(req.query.customer_module),
      status: asStr(req.query.customer_status),
      problem_type: asStr(req.query.customer_problem_type),
    });
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

router.get('/clients', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    const asStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const aggregate = await buildOwnerClientsListAggregate(ctx, {
      country: asStr(req.query.country),
      plan: asStr(req.query.plan),
      status: asStr(req.query.status),
      module: asStr(req.query.module),
      health: asStr(req.query.health),
      include_hidden: req.query.include_hidden === 'true' || req.query.include_hidden === '1',
    });
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

router.get('/client-detail', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    const organizationId = typeof req.query.organization_id === 'string' ? req.query.organization_id.trim() : '';
    if (!organizationId) throw badRequest('organization_id is required');
    const aggregate = await buildOwnerClientDetailAggregate(ctx, organizationId);
    return res.json(aggregate);
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

router.get('/currencies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    return res.json(await buildOwnerCurrenciesAggregate(ctx));
  } catch (e) {
    next(e);
  }
});

router.get('/languages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    const locale = typeof req.query.locale === 'string' ? req.query.locale : undefined;
    return res.json(await buildOwnerLanguagesAggregate(ctx, locale));
  } catch (e) {
    next(e);
  }
});

router.get('/invoice-document-builder', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    await assertOwnerOrAuditFailure(ctx, req);
    const asStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const aggregate = await buildOwnerInvoiceDocumentBuilderAggregate(ctx, {
      layout_key: asStr(req.query.layout_key) ?? undefined,
      document_type_group: asStr(req.query.document_type_group) ?? undefined,
      country_code: req.query.country_code === undefined ? 'IL' : asStr(req.query.country_code),
      version_id: asStr(req.query.version_id),
      template_family: asStr(req.query.template_family),
      preview_logo_size_key: asStr(req.query.preview_logo_size_key),
      preview_color_theme_key: asStr(req.query.preview_color_theme_key),
    });
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

    if (isOwnerInvoiceLayoutCommand(commandName)) {
      const out = await executeOwnerInvoiceLayoutCommand(
        ctx,
        commandName,
        payload as Record<string, unknown>,
      );
      return res.json(out);
    }

    if (isPlatformLocalizationCommand(commandName)) {
      const out = await executePlatformLocalizationCommand(ctx, commandName, payload as Record<string, unknown>);
      return res.json(out);
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

