import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { requireOfficeAdministration } from '../../middleware/requireOfficeAdministration.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { RBAC_PERMISSIONS } from '../rbac/rbac.service.js';
import {
  buildOfficePaymentsAggregate,
  executeOfficePaymentCommand,
  ingestPaymentWebhook,
  isOfficePaymentCommand,
} from './payment-infrastructure.service.js';
import { executeStaffSeatPurchaseCommand } from './staff-seat-purchase.service.js';

const officeRead = [
  authMiddleware,
  requireOrg,
  requireOfficeAdministration,
  requirePermission(RBAC_PERMISSIONS.payments_office_read, 'settings:read', 'access_settings'),
];

const officeWrite = [
  authMiddleware,
  requireOrg,
  requireOfficeAdministration,
  rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 20,
    keyGenerator: (req) => String(req.context?.user.id ?? 'anon'),
    message: 'Too many requests. Please wait and try again later.',
  }),
  requirePermission(RBAC_PERMISSIONS.payments_office_connect, 'settings:write', 'access_settings'),
];

const seatWrite = [
  authMiddleware,
  requireOrg,
  requireOfficeAdministration,
  rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 30,
    keyGenerator: (req) => String(req.context?.user.id ?? 'anon'),
    message: 'Too many requests. Please wait and try again later.',
  }),
  requirePermission('invite_users', 'members:write'),
];

export const paymentOfficeRoutes = Router();

paymentOfficeRoutes.get('/:id/aggregates/office-payments', ...officeRead, async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    }
    return res.json(await buildOfficePaymentsAggregate(req.context!, req.params.id));
  } catch (e) {
    next(e);
  }
});

const seatCommands = [
  'quote_staff_seat_purchase',
  'create_staff_seat_purchase_intent',
  'cancel_staff_seat_purchase_intent',
  'confirm_staff_seat_purchase_from_client',
] as const;

for (const command of seatCommands) {
  paymentOfficeRoutes.post(`/:id/commands/${command}`, ...seatWrite, async (req, res, next) => {
    try {
      if (req.params.id !== req.context!.organizationId) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
      }
      return res.json(await executeStaffSeatPurchaseCommand(req.context!, req.params.id, command, req.body ?? {}));
    } catch (e) {
      next(e);
    }
  });
}

paymentOfficeRoutes.post('/:id/commands/:command', ...officeWrite, async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    }
    const command = String(req.params.command ?? '');
    if (!isOfficePaymentCommand(command)) {
      return res.status(400).json({ code: 'UNKNOWN_COMMAND', message: 'Unknown command' });
    }
    return res.json(
      await executeOfficePaymentCommand(req.context!, req.params.id, command, (req.body ?? {}) as Record<string, unknown>),
    );
  } catch (e) {
    next(e);
  }
});

export const paymentWebhookRoutes = Router();

paymentWebhookRoutes.post(
  '/:providerCode',
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    keyGenerator: (req) => `pay-wh:${req.ip ?? 'unknown'}:${req.params.providerCode}`,
    message: 'Too many webhook requests.',
  }),
  async (req, res, next) => {
    try {
      const raw = Buffer.isBuffer(req.body)
        ? req.body.toString('utf8')
        : typeof req.body === 'string'
          ? req.body
          : JSON.stringify(req.body ?? {});
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        headers[key.toLowerCase()] = Array.isArray(value) ? value.join(',') : String(value ?? '');
      }
      const result = await ingestPaymentWebhook({
        providerCode: String(req.params.providerCode ?? '').trim().toLowerCase(),
        headers,
        rawBody: raw,
      });
      return res.status(202).json(result);
    } catch (e) {
      next(e);
    }
  },
);
