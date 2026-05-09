import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { requireModuleActive } from '../../middleware/requireModuleActive.js';
import { listClientOperationsRegistry, getClientOperationsCase, } from './client-operations.service.js';
import { executeClientOperationsProfileCommand, executeClientOperationsTaxSettingsCommand, } from './client-operations-commands.service.js';
import { executeClientHistoryTabCommand, exportClientHistoryReport, } from './client-history-tab.service.js';
import { listOperationalNoteTypes, listOperationalNotes, createOperationalNote, updateOperationalNote, deleteOperationalNote, getDueReminders, } from './client-operations-notes.service.js';
import { getClientTaxSettings, revealClientPaymentSecret, } from './client-tax-settings.service.js';
import { executeTaxTabCommand } from './client-tax-commands.service.js';
import { executeAccountingCommand } from './client-accounting-commands.service.js';
import { requestPaymentCardAccessCode, verifyPaymentCardAccessCode, } from './payment-card-access.service.js';
import { replaceClientAccountingVehicles, updateClientAccountingGeneral, } from './client-accounting.service.js';
import { saveClientBusinessProfileSection } from './client-business-profile.service.js';
import { addExpenseManagementCustomFieldApi, evaluateAccountingModalFieldVisibility, getAccountingBlockModal, getAccountingSettingsTab, normalizeAccountingBlockDraft, removeExpenseManagementCustomFieldApi, saveAccountingBlock, } from './client-accounting-tab.service.js';
import { createVehicleFleetItem, deleteVehicleFleetItem, evaluateVehicleItemModalVisibility, getVehicleFleetFileOpenUrl, getVehicleFleetItemModal, updateVehicleFleetItem, uploadVehicleFleetDocument, } from './client-vehicle-fleet.service.js';
import { executeFeesTabCommand, parseFeesPriceChartView } from './client-fees-tab.service.js';
import { executePayrollTabCommand } from './client-payroll-tab.service.js';
import { executeAnnualTabCommand, getAnnualReportDocumentFileOpenUrl, uploadAnnualReportDocument, } from './client-annual-report-tab.service.js';
import { executeClientDocumentsTabCommand, getClientDocumentFileOpenUrl, uploadClientWorkspaceDocument, } from './client-documents-tab.service.js';
import { executeClientObligationsCommand, executeClientTasksCommand, } from './client-obligations-tasks-core.service.js';
const MODULE_CODE = 'client-operations';
const router = Router();
const withView = [requirePermission('client_operations.view')];
const withEdit = [requirePermission('client_operations.edit')];
const withBusinessProfileEdit = [requirePermission('business_profile.edit', 'client_operations.edit')];
const withAccountingTabView = [requirePermission('accounting_settings_tab.view', 'client_operations.view')];
const withAccountingBlockEdit = [
    requirePermission('accounting_settings_expenses.edit', 'accounting_settings_income.edit', 'accounting_settings_expense_management.edit', 'accounting_settings_documents.edit', 'accounting_settings_vehicles.edit', 'business_profile.edit', 'client_operations.edit'),
];
const withFeesEdit = [requirePermission('fees_tab.edit', 'client_operations.edit')];
const withPayrollEdit = [requirePermission('payroll_tab.edit', 'client_operations.edit')];
const withAnnualView = [requirePermission('annual_report_tab.view', 'client_operations.view')];
const withAnnualEdit = [requirePermission('annual_report_tab.edit', 'client_operations.edit')];
function parseAnnualTabScope(v) {
    return v === 'capital_declaration' ? 'capital_declaration' : 'annual_report';
}
const withClientDocumentsView = [requirePermission('client_documents_tab.view', 'client_operations.view')];
const withClientDocumentsEdit = [requirePermission('client_documents_tab.edit', 'client_operations.edit')];
router.get('/registry', ...withView, async (req, res, next) => {
    try {
        const ctx = req.context;
        const result = await listClientOperationsRegistry(ctx);
        return res.json(result);
    }
    catch (e) {
        next(e);
    }
});
router.get('/note-types', ...withView, async (req, res, next) => {
    try {
        const result = await listOperationalNoteTypes();
        return res.json(result);
    }
    catch (e) {
        next(e);
    }
});
router.get('/reminders/due', ...withView, async (req, res, next) => {
    try {
        const ctx = req.context;
        const result = await getDueReminders(ctx);
        return res.json(result);
    }
    catch (e) {
        next(e);
    }
});
router.get('/clients/:clientId', ...withView, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const feesPv = parseFeesPriceChartView(req.query.fees_price_chart_view);
        const result = await getClientOperationsCase(ctx, clientId, { feesPriceChartView: feesPv });
        return res.json(result);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/history/commands', ...withView, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const body = (req.body ?? {});
        const feesPv = parseFeesPriceChartView(req.body?.fees_price_chart_view);
        const historyOpenSection = await executeClientHistoryTabCommand(ctx, clientId, body);
        const out = await getClientOperationsCase(ctx, clientId, {
            feesPriceChartView: feesPv,
            historyOpenSection: historyOpenSection ?? null,
        });
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/history/export', ...withView, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const body = (req.body ?? {});
        const out = await exportClientHistoryReport(ctx, clientId, body);
        res.setHeader('Content-Type', out.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${out.dispositionFilename}"`);
        return res.status(200).send(out.body);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/profile/commands/update_profile', ...withEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const out = await executeClientOperationsProfileCommand(ctx, clientId, 'update_profile', req.body ?? {});
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/fees/commands', ...withFeesEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const body = (req.body ?? {});
        await executeFeesTabCommand(ctx, clientId, body);
        const feesPv = parseFeesPriceChartView(body.fees_price_chart_view);
        const out = await getClientOperationsCase(ctx, clientId, { feesPriceChartView: feesPv });
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/payroll/commands', ...withPayrollEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const body = (req.body ?? {});
        await executePayrollTabCommand(ctx, clientId, body);
        const out = await getClientOperationsCase(ctx, clientId);
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/annual/commands', ...withAnnualEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const body = (req.body ?? {});
        const feesPv = parseFeesPriceChartView(req.body?.fees_price_chart_view);
        await executeAnnualTabCommand(ctx, clientId, body);
        const out = await getClientOperationsCase(ctx, clientId, { feesPriceChartView: feesPv });
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/annual/upload', ...withAnnualEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const orgId = ctx.organizationId;
        const out = await uploadAnnualReportDocument(ctx, orgId, clientId, (req.body ?? {}));
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.get('/clients/:clientId/annual/files/:fileAssetId/open', ...withAnnualView, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        const fileAssetId = String(req.params.fileAssetId ?? '');
        if (!clientId || !fileAssetId) {
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId and fileAssetId required' });
        }
        const orgId = ctx.organizationId;
        const scope = parseAnnualTabScope(req.query?.tab_scope);
        const out = await getAnnualReportDocumentFileOpenUrl(ctx, orgId, clientId, fileAssetId, scope);
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/documents/commands', ...withClientDocumentsEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const body = (req.body ?? {});
        const feesPv = parseFeesPriceChartView(req.body?.fees_price_chart_view);
        await executeClientDocumentsTabCommand(ctx, clientId, body);
        const out = await getClientOperationsCase(ctx, clientId, {
            feesPriceChartView: feesPv,
            skipEnsureClientDocumentFolders: true,
        });
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/obligations/commands', ...withEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const body = (req.body ?? {});
        await executeClientObligationsCommand(ctx, clientId, body);
        const feesPv = parseFeesPriceChartView(req.body?.fees_price_chart_view);
        const out = await getClientOperationsCase(ctx, clientId, { feesPriceChartView: feesPv });
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/tasks/commands', ...withEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const body = (req.body ?? {});
        await executeClientTasksCommand(ctx, clientId, body);
        const feesPv = parseFeesPriceChartView(req.body?.fees_price_chart_view);
        const out = await getClientOperationsCase(ctx, clientId, { feesPriceChartView: feesPv });
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/documents/upload', ...withClientDocumentsEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const orgId = ctx.organizationId;
        const out = await uploadClientWorkspaceDocument(ctx, orgId, clientId, (req.body ?? {}));
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.get('/clients/:clientId/documents/files/:fileAssetId/open', ...withClientDocumentsView, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        const fileAssetId = String(req.params.fileAssetId ?? '');
        if (!clientId || !fileAssetId) {
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId and fileAssetId required' });
        }
        const orgId = ctx.organizationId;
        const out = await getClientDocumentFileOpenUrl(ctx, orgId, clientId, fileAssetId);
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.get('/clients/:clientId/tax-settings', ...withView, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const out = await getClientTaxSettings(ctx, clientId);
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/tax-settings/commands/update_tax_settings', ...withEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const out = await executeClientOperationsTaxSettingsCommand(ctx, clientId, 'update_tax_settings', req.body ?? {}, { fees_price_chart_view: req.body?.fees_price_chart_view });
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
/**
 * Tax tab write path (NodexPro): one command per action → updateClientTaxSettings(partial) → full client case.
 */
router.post('/clients/:clientId/tax/commands', ...withEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const body = (req.body ?? {});
        const out = await executeTaxTabCommand(ctx, clientId, body);
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
/** הגדרות הנה״ח — פקודות (NodexPro): domain save → full client case. */
router.post('/clients/:clientId/accounting/commands', ...withAccountingBlockEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const body = (req.body ?? {});
        const out = await executeAccountingCommand(ctx, clientId, body);
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/accounting/general/commands/update_accounting_general', ...withEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const out = await updateClientAccountingGeneral(ctx, clientId, req.body ?? {});
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/accounting/vehicles/commands/replace_accounting_vehicles', ...withEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const body = (req.body ?? {});
        const out = await replaceClientAccountingVehicles(ctx, clientId, {
            vehicles: Array.isArray(body.vehicles) ? body.vehicles : [],
        });
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
/** @deprecated Legacy bypass: does not return full refreshed case. Prefer POST /accounting/commands with type save_accounting_business_profile. */
router.post('/clients/:clientId/accounting/business-profile/commands/save_business_profile', ...withBusinessProfileEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const out = await saveClientBusinessProfileSection(ctx, clientId, req.body ?? {});
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.get('/clients/:clientId/accounting-settings/tab', ...withAccountingTabView, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const out = await getAccountingSettingsTab(ctx, clientId);
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
/** Per-vehicle create/edit modal schema (read model). ?vehicle_id=uuid omit for new vehicle */
router.get('/clients/:clientId/accounting-settings/vehicle-fleet/item-modal', ...withAccountingTabView, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        const q = req.query.vehicle_id;
        const vehicleId = typeof q === 'string' && /^[0-9a-f-]{36}$/i.test(q) ? q : null;
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const orgId = ctx.organizationId;
        const p = ctx.membership?.permissions ?? [];
        const canEdit = p.includes('accounting_settings_vehicles.edit') || p.includes('client_operations.edit');
        const out = await getVehicleFleetItemModal(ctx, orgId, clientId, vehicleId, canEdit);
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/accounting-settings/vehicle-fleet/item-modal-visibility', ...withAccountingTabView, async (req, res, next) => {
    try {
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const out = await evaluateVehicleItemModalVisibility((req.body ?? {}));
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/accounting-settings/vehicle-fleet/items', ...withAccountingBlockEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        await createVehicleFleetItem(ctx, clientId, (req.body ?? {}));
        const tab = await getAccountingSettingsTab(ctx, clientId);
        return res.status(201).json(tab);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/accounting-settings/vehicle-fleet/items/:vehicleId/commands/update_vehicle_fleet_item', ...withAccountingBlockEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        const vehicleId = String(req.params.vehicleId ?? '');
        if (!clientId || !vehicleId) {
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId and vehicleId required' });
        }
        await updateVehicleFleetItem(ctx, clientId, vehicleId, (req.body ?? {}));
        const tab = await getAccountingSettingsTab(ctx, clientId);
        return res.json(tab);
    }
    catch (e) {
        next(e);
    }
});
router.delete('/clients/:clientId/accounting-settings/vehicle-fleet/items/:vehicleId', ...withAccountingBlockEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        const vehicleId = String(req.params.vehicleId ?? '');
        if (!clientId || !vehicleId) {
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId and vehicleId required' });
        }
        await deleteVehicleFleetItem(ctx, clientId, vehicleId, (req.body ?? {}));
        const tab = await getAccountingSettingsTab(ctx, clientId);
        return res.json(tab);
    }
    catch (e) {
        next(e);
    }
});
router.get('/clients/:clientId/accounting-settings/blocks/:blockKey/modal', ...withAccountingTabView, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        const blockKey = String(req.params.blockKey ?? '');
        if (!clientId || !blockKey) {
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId and blockKey required' });
        }
        if (!['expenses', 'income', 'expense_management', 'documents', 'vehicles'].includes(blockKey)) {
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'invalid blockKey' });
        }
        const out = await getAccountingBlockModal(ctx, clientId, blockKey);
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
/** Field visibility map from current draft (server-owned). */
router.post('/clients/:clientId/accounting-settings/blocks/:blockKey/modal-visibility', ...withAccountingTabView, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        const blockKey = String(req.params.blockKey ?? '');
        if (!clientId || !blockKey) {
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId and blockKey required' });
        }
        if (!['expenses', 'income', 'expense_management', 'documents', 'vehicles'].includes(blockKey)) {
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'invalid blockKey' });
        }
        const out = await evaluateAccountingModalFieldVisibility(ctx, clientId, blockKey, (req.body ?? {}));
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
/** Apply server-owned rules to in-modal draft (toggle defaults, cleared fields). expenses | income only. */
router.post('/clients/:clientId/accounting-settings/blocks/:blockKey/normalize-draft', ...withAccountingTabView, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        const blockKey = String(req.params.blockKey ?? '');
        if (!clientId || !blockKey) {
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId and blockKey required' });
        }
        if (blockKey !== 'expenses' && blockKey !== 'income') {
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'normalize-draft only for expenses or income' });
        }
        const out = await normalizeAccountingBlockDraft(ctx, clientId, blockKey, (req.body ?? {}));
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/accounting-settings/blocks/:blockKey/commands/save_block', ...withAccountingBlockEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        const blockKey = String(req.params.blockKey ?? '');
        if (!clientId || !blockKey) {
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId and blockKey required' });
        }
        if (!['expenses', 'income', 'expense_management', 'documents', 'vehicles'].includes(blockKey)) {
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'invalid blockKey' });
        }
        const out = await saveAccountingBlock(ctx, clientId, blockKey, (req.body ?? {}));
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/accounting-settings/blocks/expense_management/custom-fields', ...withAccountingBlockEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const out = await addExpenseManagementCustomFieldApi(ctx, clientId, (req.body ?? {}));
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.delete('/clients/:clientId/accounting-settings/blocks/expense_management/custom-fields/:fieldId', ...withAccountingBlockEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        const fieldId = String(req.params.fieldId ?? '');
        if (!clientId || !fieldId) {
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId and fieldId required' });
        }
        const out = await removeExpenseManagementCustomFieldApi(ctx, clientId, fieldId);
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/accounting-settings/vehicle-fleet/upload', ...withAccountingBlockEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const orgId = ctx.organizationId;
        const uploaded = await uploadVehicleFleetDocument(ctx, orgId, clientId, (req.body ?? {}));
        const feesPv = parseFeesPriceChartView(req.query.fees_price_chart_view);
        const client_operations_case = await getClientOperationsCase(ctx, clientId, { feesPriceChartView: feesPv });
        return res.json({ ...uploaded, client_operations_case });
    }
    catch (e) {
        next(e);
    }
});
router.get('/clients/:clientId/accounting-settings/vehicle-fleet/files/:fileAssetId/open', ...withAccountingTabView, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        const fileAssetId = String(req.params.fileAssetId ?? '');
        if (!clientId || !fileAssetId) {
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId and fileAssetId required' });
        }
        const orgId = ctx.organizationId;
        const out = await getVehicleFleetFileOpenUrl(ctx, orgId, clientId, fileAssetId);
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
/** Single-field reveal for secure copy — never returns full card + CVV in one response */
router.post('/clients/:clientId/tax-settings/reveal-payment-secret', ...withEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const type = req.body?.type;
        const secretKind = req.body?.secret_kind;
        if (type !== 'vat' && type !== 'income_tax') {
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'type must be vat or income_tax' });
        }
        const allowed = new Set(['card_number', 'expiry']);
        if (typeof secretKind !== 'string' || !allowed.has(secretKind)) {
            return res.status(400).json({
                code: 'BAD_REQUEST',
                message: 'secret_kind must be card_number or expiry (CVV is never stored)',
            });
        }
        const payload = await revealClientPaymentSecret(ctx, clientId, type, secretKind);
        return res.json(payload);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/tax-settings/payment-card/request-code', ...withEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const t = req.body?.type;
        if (t !== 'vat' && t !== 'income_tax') {
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'type must be vat or income_tax' });
        }
        const out = await requestPaymentCardAccessCode(ctx, clientId, t);
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/tax-settings/payment-card/verify-code', ...withEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const t = req.body?.type;
        const challengeId = req.body?.challenge_id;
        const code = req.body?.code;
        if (t !== 'vat' && t !== 'income_tax') {
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'type must be vat or income_tax' });
        }
        if (typeof challengeId !== 'string' || !challengeId.trim()) {
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'challenge_id required' });
        }
        if (typeof code !== 'string' || !code.trim()) {
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'code required' });
        }
        const out = await verifyPaymentCardAccessCode(ctx, clientId, challengeId.trim(), code.trim(), t);
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.get('/clients/:clientId/operational-notes', ...withView, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const result = await listOperationalNotes(ctx, clientId);
        return res.json(result);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/operational-notes', ...withEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        if (!clientId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId required' });
        const out = await createOperationalNote(ctx, clientId, req.body ?? {});
        if ('conflict' in out && out.conflict) {
            return res.status(409).json({
                code: 'REMINDER_CONFLICT',
                ui: out.ui,
                conflicts: out.conflicts,
            });
        }
        return res.status(201).json(out);
    }
    catch (e) {
        next(e);
    }
});
router.post('/clients/:clientId/operational-notes/:noteId/commands/update_note', ...withEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        const noteId = String(req.params.noteId ?? '');
        if (!clientId || !noteId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId and noteId required' });
        const out = await updateOperationalNote(ctx, clientId, noteId, req.body ?? {});
        if ('conflict' in out && out.conflict) {
            return res.status(409).json({
                code: 'REMINDER_CONFLICT',
                ui: out.ui,
                conflicts: out.conflicts,
            });
        }
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.delete('/clients/:clientId/operational-notes/:noteId', ...withEdit, async (req, res, next) => {
    try {
        const ctx = req.context;
        const clientId = String(req.params.clientId ?? '');
        const noteId = String(req.params.noteId ?? '');
        if (!clientId || !noteId)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'clientId and noteId required' });
        await deleteOperationalNote(ctx, clientId, noteId);
        return res.status(204).send();
    }
    catch (e) {
        next(e);
    }
});
export const clientOperationsModuleRouter = Router();
clientOperationsModuleRouter.use(authMiddleware, requireOrg, requireModuleActive(MODULE_CODE), router);
