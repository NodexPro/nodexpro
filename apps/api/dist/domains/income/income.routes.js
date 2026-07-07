/**
 * Income module routes (INC-1b / INC-2).
 * Mounted at /api/v1/income.
 */
import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireModuleActive } from '../../middleware/requireModuleActive.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { executeIncomeCommand } from './income-commands.service.js';
import { buildIncomeWorkspaceContextAggregate } from './income-issuer-context.service.js';
import { downloadIncomeDocumentPdfBuffer } from './income-document-pdf.service.js';
import { buildIncomeWorkspaceAggregate } from './income-workspace-aggregate.service.js';
import { buildIncomeClientIncomeLedgerCardAggregate } from './income-client-income-ledger-card.service.js';
import { buildIncomeDocumentEmailHistoryAggregate, buildIncomeRepresentedClientEmailHistoryAggregate, } from './income-document-email-history.service.js';
import { buildIncomeDocumentDocflowSendAggregate } from './income-document-docflow-send.service.js';
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
router.get('/aggregates/workspace', requirePermission(INCOME_PERMISSIONS.view), async (req, res, next) => {
    try {
        const aggregate = await buildIncomeWorkspaceAggregate(req.context);
        return res.json(aggregate);
    }
    catch (e) {
        next(e);
    }
});
router.get('/aggregates/client-income-ledger-card', requirePermission(INCOME_PERMISSIONS.view), async (req, res, next) => {
    try {
        const representedClientId = String(req.query.represented_client_id ?? '').trim();
        const endCustomerIdRaw = String(req.query.end_customer_id ?? '').trim();
        const yearRaw = String(req.query.year ?? '').trim();
        const year = yearRaw ? Number(yearRaw) : null;
        const aggregate = await buildIncomeClientIncomeLedgerCardAggregate({
            ctx: req.context,
            representedClientId,
            endCustomerId: endCustomerIdRaw || null,
            year: year != null && Number.isFinite(year) ? year : null,
        });
        return res.json(aggregate);
    }
    catch (e) {
        next(e);
    }
});
router.get('/aggregates/document-email-history', requirePermission(INCOME_PERMISSIONS.view), async (req, res, next) => {
    try {
        const incomeDocumentId = String(req.query.income_document_id ?? '').trim();
        const aggregate = await buildIncomeDocumentEmailHistoryAggregate({
            ctx: req.context,
            incomeDocumentId,
        });
        return res.json(aggregate);
    }
    catch (e) {
        next(e);
    }
});
router.get('/aggregates/represented-client-email-history', requirePermission(INCOME_PERMISSIONS.view), async (req, res, next) => {
    try {
        const representedClientId = String(req.query.represented_client_id ?? '').trim();
        const aggregate = await buildIncomeRepresentedClientEmailHistoryAggregate({
            ctx: req.context,
            representedClientId,
        });
        return res.json(aggregate);
    }
    catch (e) {
        next(e);
    }
});
router.get('/aggregates/document-docflow-send', requirePermission(INCOME_PERMISSIONS.view), async (req, res, next) => {
    try {
        const incomeDocumentId = String(req.query.income_document_id ?? '').trim();
        const aggregate = await buildIncomeDocumentDocflowSendAggregate({
            ctx: req.context,
            incomeDocumentId,
        });
        return res.json(aggregate);
    }
    catch (e) {
        next(e);
    }
});
router.post('/commands', requirePermission(INCOME_PERMISSIONS.edit), async (req, res, next) => {
    try {
        const out = await executeIncomeCommand(req.context, req.body, {
            ipAddress: typeof req.ip === 'string' && req.ip ? req.ip : null,
            userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
        });
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.get('/documents/:id/download', requirePermission(INCOME_PERMISSIONS.view), async (req, res, next) => {
    try {
        const { buffer, fileName } = await downloadIncomeDocumentPdfBuffer(req.context, String(req.params.id));
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`);
        return res.send(buffer);
    }
    catch (e) {
        next(e);
    }
});
router.post('/commands/select_issuer_context', requirePermission(INCOME_PERMISSIONS.edit), async (req, res, next) => {
    try {
        const out = await executeIncomeCommand(req.context, {
            ...req.body,
            command: 'select_income_issuer_context',
        }, {
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
