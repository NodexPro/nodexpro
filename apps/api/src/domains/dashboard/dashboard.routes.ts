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

router.get('/office-fee-breakdown', authMiddleware, requireOrg, requireOfficeAdministration, async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const period = typeof req.query.period === 'string' ? req.query.period : undefined;
    const locale = typeof req.query.locale === 'string' ? req.query.locale : undefined;
    const page = typeof req.query.page === 'string' ? req.query.page : undefined;
    const page_size = typeof req.query.page_size === 'string' ? req.query.page_size : undefined;
    const sort = typeof req.query.sort === 'string' ? req.query.sort : undefined;
    const sort_dir = typeof req.query.sort_dir === 'string' ? req.query.sort_dir : undefined;
    const filter = typeof req.query.filter === 'string' ? req.query.filter : undefined;
    const breakdown = await dashboardService.getOfficeFeeBreakdown(req.context!, {
      period,
      locale,
      q,
      page,
      page_size,
      sort,
      sort_dir,
      filter,
    });
    return res.json(breakdown);
  } catch (e) {
    next(e);
  }
});

export const dashboardRoutes = router;
