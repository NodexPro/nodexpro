import { Router, type NextFunction, type Request, type Response } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { requireModuleActive } from '../../middleware/requireModuleActive.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import type { RequestContext } from '../../shared/context.js';
import { getRequiredOrgId } from '../../shared/context.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { TAX_ADVISORY_MODULE_CODE, TAX_ADVISORY_PERMISSIONS } from './tax-advisory.types.js';
import { executeTaxAdvisoryCommand } from './tax-advisory-commands.service.js';
import {
  buildTaxAdvisoryCaseAggregate,
  isTaxAdvisoryUuid,
  loadTaxAdvisoryClient,
} from './tax-advisory-read-models.service.js';

const router = Router();
router.use(authMiddleware, requireOrg, requireModuleActive(TAX_ADVISORY_MODULE_CODE));

router.get(
  '/clients/:clientId',
  requirePermission(TAX_ADVISORY_PERMISSIONS.view),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.context as RequestContext;
      const orgId = getRequiredOrgId(req);
      const clientId = String(req.params.clientId ?? '').trim();
      if (!isTaxAdvisoryUuid(clientId)) {
        throw badRequest('clientId must be a uuid');
      }
      const client = await loadTaxAdvisoryClient(orgId, clientId);
      if (!client) throw notFound('Client not found');
      const aggregate = await buildTaxAdvisoryCaseAggregate(ctx, orgId, clientId);
      return res.json(aggregate);
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/commands',
  requirePermission(TAX_ADVISORY_PERMISSIONS.edit),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.context as RequestContext;
      getRequiredOrgId(req);
      const body = (req.body ?? {}) as { command?: unknown; payload?: unknown };
      const command = typeof body.command === 'string' ? body.command.trim() : '';
      const payload =
        body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
          ? (body.payload as Record<string, unknown>)
          : {};
      const out = await executeTaxAdvisoryCommand(ctx, command, payload);
      return res.json(out);
    } catch (e) {
      next(e);
    }
  },
);

export const taxAdvisoryRoutes = router;
