import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import * as modulesService from './modules.service.js';
import * as modulesStateService from './modules-state.service.js';
import * as activationService from './activation.service.js';
import * as moduleCommerceService from './module-commerce.service.js';

const router = Router();

router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const list = await modulesService.listRegistryWithDependencies();
    return res.json(list);
  } catch (e) {
    next(e);
  }
});

// Catalog visibility: modules:read or subscriptions:read (billing). Do not require enabledModules/trial/purchased.
router.get('/:id/modules', authMiddleware, requireOrg, requirePermission('modules:read', 'subscriptions:read'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const list = await modulesService.listOrganizationModules(req.context!, req.params.id);
    return res.json(list);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/modules/state', authMiddleware, requireOrg, requirePermission('modules:read', 'subscriptions:read'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const startMs = process.env.LOG_MODULES_STATE_TIMING === 'true' ? Date.now() : 0;
    const state = await modulesStateService.getModulesState(req.context!, req.params.id);
    if (startMs) console.log(`[modules] GET /:id/modules/state org=${req.params.id} totalMs=${Date.now() - startMs}`);
    return res.json(state);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/modules/:moduleId/activate', authMiddleware, requireOrg, requirePermission('modules:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const result = await activationService.activateModule(req.context!, req.params.id, req.params.moduleId);
    if (!result.success) return res.status(400).json({ code: 'ACTIVATION_BLOCKED', message: result.blockReason ?? 'Cannot activate' });
    return res.status(200).json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/modules/:moduleId/deactivate', authMiddleware, requireOrg, requirePermission('modules:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    await activationService.deactivateModule(req.context!, req.params.id, req.params.moduleId);
    return res.status(200).json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/modules/:moduleId/plans', authMiddleware, requireOrg, requirePermission('modules:read', 'subscriptions:read'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const plans = await moduleCommerceService.listPlansForModule(req.params.moduleId);
    return res.json(plans);
  } catch (e) {
    next(e);
  }
});

router.post('/:id/modules/:moduleId/select-plan', authMiddleware, requireOrg, requirePermission('modules:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const { modulePlanId } = req.body as { modulePlanId?: string };
    if (!modulePlanId) return res.status(400).json({ code: 'BAD_REQUEST', message: 'modulePlanId required' });
    await moduleCommerceService.selectPlan(req.context!, req.params.id, req.params.moduleId, modulePlanId);
    return res.status(200).json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/modules/:moduleId/change-plan', authMiddleware, requireOrg, requirePermission('modules:write'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const { modulePlanId } = req.body as { modulePlanId?: string };
    if (!modulePlanId) return res.status(400).json({ code: 'BAD_REQUEST', message: 'modulePlanId required' });
    await moduleCommerceService.changePlan(req.context!, req.params.id, req.params.moduleId, modulePlanId);
    return res.status(200).json({ success: true });
  } catch (e) {
    next(e);
  }
});

export const modulesRoutes = router;
