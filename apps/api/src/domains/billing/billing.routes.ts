import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { requireOfficeAdministration } from '../../middleware/requireOfficeAdministration.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { RBAC_PERMISSIONS } from '../rbac/rbac.service.js';
import {
  executeOfficePaymentCommand,
  isOfficePaymentCommand,
} from '../payments/payment-infrastructure.service.js';
import { executeStaffSeatPurchaseCommand, isStaffSeatPurchaseCommand } from '../payments/staff-seat-purchase.service.js';
import { executeModulePurchaseCommand, isModulePurchaseCommand } from './module-purchase.service.js';
import {
  buildBillingModulesAggregate,
  buildBillingPlatformPaymentsAggregate,
  buildBillingStaffLicensesAggregate,
  buildBillingWorkspaceAggregate,
  loadOfficePaymentsForBilling,
} from './billing-workspace.service.js';

const billingRead = [
  authMiddleware,
  requireOrg,
  requireOfficeAdministration,
  requirePermission(RBAC_PERMISSIONS.access_billing, 'subscriptions:read'),
];

const billingWrite = [
  authMiddleware,
  requireOrg,
  requireOfficeAdministration,
  rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 30,
    keyGenerator: (req) => String(req.context?.user.id ?? 'anon'),
    message: 'Too many requests. Please wait and try again later.',
  }),
  requirePermission(RBAC_PERMISSIONS.access_billing, 'subscriptions:read', 'modules:write', 'members:write'),
];

export const billingRoutes = Router();

billingRoutes.get('/:id/aggregates/billing-workspace', ...billingRead, async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    }
    const aggregate = await buildBillingWorkspaceAggregate(req.context!, req.params.id);
    res.setHeader('Server-Timing', `billing_workspace;dur=${aggregate.timing.load_ms}`);
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

billingRoutes.get('/:id/aggregates/billing-modules', ...billingRead, async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    }
    const aggregate = await buildBillingModulesAggregate(req.context!, req.params.id);
    res.setHeader('Server-Timing', `billing_modules;dur=${aggregate.timing.load_ms}`);
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

billingRoutes.get('/:id/aggregates/billing-staff-licenses', ...billingRead, async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    }
    const aggregate = await buildBillingStaffLicensesAggregate(req.context!, req.params.id);
    res.setHeader('Server-Timing', `billing_staff;dur=${aggregate.timing.load_ms}`);
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

billingRoutes.get('/:id/aggregates/billing-platform-payments', ...billingRead, async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    }
    const aggregate = await buildBillingPlatformPaymentsAggregate(req.context!, req.params.id);
    res.setHeader('Server-Timing', `billing_payments;dur=${aggregate.timing.load_ms}`);
    return res.json(aggregate);
  } catch (e) {
    next(e);
  }
});

billingRoutes.get('/:id/aggregates/billing-client-processing', ...billingRead, async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    }
    return res.json(await loadOfficePaymentsForBilling(req.context!, req.params.id));
  } catch (e) {
    next(e);
  }
});

billingRoutes.post('/:id/commands/:command', ...billingWrite, async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    }
    const command = String(req.params.command ?? '');
    const payload = (req.body ?? {}) as Record<string, unknown>;
    if (isStaffSeatPurchaseCommand(command)) {
      const result = await executeStaffSeatPurchaseCommand(req.context!, req.params.id, command, payload);
      const billing_staff_licenses_aggregate = await buildBillingStaffLicensesAggregate(
        req.context!,
        req.params.id,
        { quoteQuantity: Number(payload.quantity) || undefined },
      );
      return res.json({ ...result, billing_staff_licenses_aggregate });
    }
    if (isModulePurchaseCommand(command)) {
      const result = await executeModulePurchaseCommand(req.context!, req.params.id, command, payload);
      const quote = 'quote' in result ? result.quote : undefined;
      const billing_modules_aggregate = await buildBillingModulesAggregate(req.context!, req.params.id, {
        quote: quote as never,
      });
      return res.json({ ...result, billing_modules_aggregate });
    }
    if (isOfficePaymentCommand(command)) {
      const result = await executeOfficePaymentCommand(req.context!, req.params.id, command, payload);
      return res.json(result);
    }
    return res.status(400).json({ code: 'UNKNOWN_COMMAND', message: 'Unknown command' });
  } catch (e) {
    next(e);
  }
});
