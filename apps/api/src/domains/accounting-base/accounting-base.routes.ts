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
import {
  ACCOUNTING_BASE_COMMAND_RECORD_AND_ALLOCATE_INCOME_PAYMENT,
  ACCOUNTING_BASE_COMMAND_REVERSE_INCOME_PAYMENT_ALLOCATION,
} from './accounting-base-income-payment.pure.js';
import { buildIncomeInvoicePaymentCaseAggregate } from './accounting-base-income-payment-case.read.js';
import { buildAccountsReceivableAggregate } from './accounting-base-accounts-receivable.read-model.service.js';
import { buildAccountsReceivablePortfolioAggregate } from './accounting-base-accounts-receivable-portfolio.read-model.service.js';

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

/** INV-3A — open A/R list for active Income issuer scope (AB financial truth). */
router.get(
  '/aggregates/accounts-receivable',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.context as RequestContext;
      getRequiredOrgId(req);
      const aggregate = await buildAccountsReceivableAggregate({
        ctx,
        query: req.query as Record<string, unknown>,
      });
      return res.json(aggregate);
    } catch (e) {
      next(e);
    }
  },
);

/** INV-3D — office portfolio A/R across all represented clients (complete SQL rollups). */
router.get(
  '/aggregates/accounts-receivable-portfolio',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.context as RequestContext;
      getRequiredOrgId(req);
      const aggregate = await buildAccountsReceivablePortfolioAggregate({
        ctx,
        query: req.query as Record<string, unknown>,
      });
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
    const allowedCommands = [
      ACCOUNTING_BASE_COMMAND_RECORD_AND_ALLOCATE_INCOME_PAYMENT,
      ACCOUNTING_BASE_COMMAND_REVERSE_INCOME_PAYMENT_ALLOCATION,
    ] as const;
    if (!(allowedCommands as readonly string[]).includes(type)) {
      return res.status(400).json({
        error: {
          code: 'unsupported_command',
          message: `Supported commands: ${allowedCommands.join(', ')}`,
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
