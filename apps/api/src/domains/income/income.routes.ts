/**
 * Income module routes (INC-1b / INC-2).
 * Mounted at /api/v1/income.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireModuleActive } from '../../middleware/requireModuleActive.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import type { RequestContext } from '../../shared/context.js';
import { executeIncomeCommand } from './income-commands.service.js';
import { buildIncomeWorkspaceContextAggregate } from './income-issuer-context.service.js';
import { downloadIncomeDocumentPdfBuffer } from './income-document-pdf.service.js';
import { buildIncomeWorkspaceAggregate } from './income-workspace-aggregate.service.js';
import { buildIncomeClientIncomeLedgerCardAggregate } from './income-client-income-ledger-card.service.js';
import {
  buildIncomeDocumentEmailHistoryAggregate,
  buildIncomeRepresentedClientEmailHistoryAggregate,
} from './income-document-email-history.service.js';
import { buildIncomeDocumentDocflowSendAggregate } from './income-document-docflow-send.service.js';
import { buildIncomeIssuedDocumentViewAggregate } from './income-issued-document-view.service.js';
import { buildInvoiceLifecycleAggregate } from './invoice-lifecycle.read-model.service.js';
import { INCOME_MODULE_CODE, INCOME_PERMISSIONS } from './income.types.js';
import {
  CRITICAL_INCOME_COMMANDS,
  resolveCorrelationId,
  withCriticalCommandObs,
} from '../../shared/observability.js';

const router = Router();

router.get(
  '/aggregates/workspace-context',
  requirePermission(INCOME_PERMISSIONS.view),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const aggregate = await buildIncomeWorkspaceContextAggregate(req.context as RequestContext, {
        pagination: {
          office_clients: {
            limit: req.query.office_clients_limit,
            offset: req.query.office_clients_offset,
          },
          office_client_customers: {
            limit: req.query.office_client_customers_limit,
            offset: req.query.office_client_customers_offset,
          },
        },
      });
      return res.json(aggregate);
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/aggregates/workspace',
  requirePermission(INCOME_PERMISSIONS.view),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const aggregate = await buildIncomeWorkspaceAggregate(req.context as RequestContext);
      return res.json(aggregate);
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/aggregates/client-income-ledger-card',
  requirePermission(INCOME_PERMISSIONS.view),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const representedClientId = String(req.query.represented_client_id ?? '').trim();
      const endCustomerIdRaw = String(req.query.end_customer_id ?? '').trim();
      const yearRaw = String(req.query.year ?? '').trim();
      const year = yearRaw ? Number(yearRaw) : null;
      const fromDateRaw = String(req.query.from_date ?? '').trim();
      const toDateRaw = String(req.query.to_date ?? '').trim();
      const aggregate = await buildIncomeClientIncomeLedgerCardAggregate({
        ctx: req.context as RequestContext,
        representedClientId,
        endCustomerId: endCustomerIdRaw || null,
        year: year != null && Number.isFinite(year) ? year : null,
        fromDate: fromDateRaw || null,
        toDate: toDateRaw || null,
      });
      return res.json(aggregate);
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/aggregates/document-email-history',
  requirePermission(INCOME_PERMISSIONS.view),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const incomeDocumentId = String(req.query.income_document_id ?? '').trim();
      const aggregate = await buildIncomeDocumentEmailHistoryAggregate({
        ctx: req.context as RequestContext,
        incomeDocumentId,
      });
      return res.json(aggregate);
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/aggregates/represented-client-email-history',
  requirePermission(INCOME_PERMISSIONS.view),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const representedClientId = String(req.query.represented_client_id ?? '').trim();
      const incomeCustomerIdRaw = String(req.query.income_customer_id ?? '').trim();
      const aggregate = await buildIncomeRepresentedClientEmailHistoryAggregate({
        ctx: req.context as RequestContext,
        representedClientId,
        incomeCustomerId: incomeCustomerIdRaw || null,
      });
      return res.json(aggregate);
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/aggregates/document-docflow-send',
  requirePermission(INCOME_PERMISSIONS.view),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const incomeDocumentId = String(req.query.income_document_id ?? '').trim();
      const aggregate = await buildIncomeDocumentDocflowSendAggregate({
        ctx: req.context as RequestContext,
        incomeDocumentId,
      });
      return res.json(aggregate);
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/aggregates/issued-document-view',
  requirePermission(INCOME_PERMISSIONS.view),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const incomeDocumentId = String(req.query.income_document_id ?? '').trim();
      const aggregate = await buildIncomeIssuedDocumentViewAggregate({
        ctx: req.context as RequestContext,
        incomeDocumentId,
      });
      return res.json(aggregate);
    } catch (e) {
      next(e);
    }
  },
);

/** INV-2A — composed invoice lifecycle dimensions (Income owns the composer route; modules keep field ownership). */
router.get(
  '/aggregates/invoice-lifecycle',
  requirePermission(INCOME_PERMISSIONS.view),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const incomeDocumentId = String(req.query.income_document_id ?? '').trim();
      const aggregate = await buildInvoiceLifecycleAggregate({
        ctx: req.context as RequestContext,
        incomeDocumentId,
      });
      return res.json(aggregate);
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/commands',
  requirePermission(INCOME_PERMISSIONS.edit),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.context as RequestContext;
      const body = req.body as Record<string, unknown>;
      const command = String(body.command ?? '').trim();
      const correlation_id = ctx.correlationId ?? resolveCorrelationId(req.correlationId);
      const out = await withCriticalCommandObs(
        {
          enabled: CRITICAL_INCOME_COMMANDS.has(command),
          correlation_id,
          module: 'income',
          command: command || 'unknown',
          organization_id: ctx.organizationId,
          draft_id: typeof body.draft_id === 'string' ? body.draft_id : null,
          income_document_id:
            typeof body.income_document_id === 'string' ? body.income_document_id : null,
        },
        () =>
          executeIncomeCommand(ctx, body, {
            ipAddress: typeof req.ip === 'string' && req.ip ? req.ip : null,
            userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
          }),
        (result) => ({
          income_document_id:
            result && typeof result === 'object' && 'meta' in result
              ? ((result as { meta?: { income_document_id?: string } }).meta?.income_document_id ??
                null)
              : null,
        }),
      );
      return res.json(out);
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/documents/:id/download',
  requirePermission(INCOME_PERMISSIONS.view),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { buffer, fileName } = await downloadIncomeDocumentPdfBuffer(
        req.context as RequestContext,
        String(req.params.id),
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`);
      return res.send(buffer);
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/commands/select_issuer_context',
  requirePermission(INCOME_PERMISSIONS.edit),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await executeIncomeCommand(
        req.context as RequestContext,
        {
          ...(req.body as Record<string, unknown>),
          command: 'select_income_issuer_context',
        },
        {
          ipAddress: typeof req.ip === 'string' && req.ip ? req.ip : null,
          userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
        },
      );
      return res.json(out);
    } catch (e) {
      next(e);
    }
  },
);

export const incomeRoutes = Router();
incomeRoutes.use(
  authMiddleware,
  requireOrg,
  requireModuleActive(INCOME_MODULE_CODE),
  router,
);
