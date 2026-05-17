/**
 * Income module routes (INC-1b).
 * Mounted at /api/v1/income.
 */
import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireModuleActive } from '../../middleware/requireModuleActive.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { buildIncomeWorkspaceContextAggregate, executeSelectIncomeIssuerContextCommand, } from './income-issuer-context.service.js';
import { INCOME_MODULE_CODE, INCOME_PERMISSIONS } from './income.types.js';
const router = Router();
router.get('/aggregates/workspace-context', requirePermission(INCOME_PERMISSIONS.view), async (req, res, next) => {
    try {
        const aggregate = await buildIncomeWorkspaceContextAggregate(req.context);
        return res.json(aggregate);
    }
    catch (e) {
        next(e);
    }
});
router.post('/commands/select_issuer_context', requirePermission(INCOME_PERMISSIONS.edit), async (req, res, next) => {
    try {
        const out = await executeSelectIncomeIssuerContextCommand(req.context, req.body, {
            ipAddress: typeof req.ip === 'string' && req.ip ? req.ip : null,
            userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
        });
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
export const incomeRoutes = Router();
incomeRoutes.use(authMiddleware, requireOrg, requireModuleActive(INCOME_MODULE_CODE), router);
