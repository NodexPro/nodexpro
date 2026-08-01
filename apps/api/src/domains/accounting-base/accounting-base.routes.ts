/**
 * Accounting Base HTTP surface — INV-5A payment allocation only (no generic CRUD).
 * Mounted at /api/v1/accounting-base.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import type { RequestContext } from '../../shared/context.js';
import { getRequiredOrgId } from '../../shared/context.js';
import { executeAccountingBaseCommand } from './accounting-base-commands.service.js';
import { ACCOUNTING_BASE_COMMAND_RECORD_AND_ALLOCATE_INCOME_PAYMENT } from './accounting-base-income-payment.pure.js';
import { buildIncomeInvoicePaymentCaseAggregate } from './accounting-base-income-payment-case.read.js';

const router = Router();

router.get(
  '/aggregates/income-invoice-payment-case',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.context as RequestContext;
      const orgId = getRequiredOrgId(req);
      const incomeDocumentId = String(req.query.income_document_id ?? '').trim();
      const aggregate = await buildIncomeInvoicePaymentCaseAggregate(ctx, orgId, incomeDocumentId);
      return res.json(aggregate);
    } catch (e) {
      next(e);
    }
  },
);

router.post('/commands', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.context as RequestContext;
    const orgId = getRequiredOrgId(req);
    const body = (req.body ?? {}) as { type?: string; payload?: Record<string, unknown> };
    const type = String(body.type ?? '').trim();
    if (type !== ACCOUNTING_BASE_COMMAND_RECORD_AND_ALLOCATE_INCOME_PAYMENT) {
      return res.status(400).json({
        error: {
          code: 'unsupported_command',
          message: `Only ${ACCOUNTING_BASE_COMMAND_RECORD_AND_ALLOCATE_INCOME_PAYMENT} is exposed on this route`,
        },
      });
    }
    const out = await executeAccountingBaseCommand(ctx, orgId, body);
    return res.json(out);
  } catch (e) {
    next(e);
  }
});

export const accountingBaseRoutes = Router();
accountingBaseRoutes.use(authMiddleware, requireOrg, router);
