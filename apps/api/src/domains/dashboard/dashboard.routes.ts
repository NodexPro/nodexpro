import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { requireOfficeAdministration } from '../../middleware/requireOfficeAdministration.js';
import * as dashboardService from './dashboard.service.js';

const router = Router();

router.get('/summary', authMiddleware, requireOrg, requireOfficeAdministration, async (req, res, next) => {
  try {
    const summary = await dashboardService.getDashboardSummary(req.context!);
    return res.json(summary);
  } catch (e) {
    next(e);
  }
});

router.get('/overview', authMiddleware, requireOrg, requireOfficeAdministration, async (req, res, next) => {
  try {
    const period = typeof req.query.period === 'string' ? req.query.period : undefined;
    const locale = typeof req.query.locale === 'string' ? req.query.locale : undefined;
    const overview = await dashboardService.getDashboardOverview(req.context!, { period, locale });
    return res.json(overview);
  } catch (e) {
    next(e);
  }
});

export const dashboardRoutes = router;
