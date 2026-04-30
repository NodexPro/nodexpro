import { AppError, badRequest, conflict, forbidden } from '../../shared/errors.js';
import { getClientOperationsCase } from './client-operations.service.js';
import { parseFeesPriceChartView } from './client-fees-tab.service.js';
import { addExpenseManagementCustomFieldApi, canEditBlock, removeExpenseManagementCustomFieldApi, saveAccountingBlock, } from './client-accounting-tab.service.js';
import { createVehicleFleetItem, deleteVehicleFleetItem, updateVehicleFleetItem, } from './client-vehicle-fleet.service.js';
import { saveClientBusinessProfileSection, } from './client-business-profile.service.js';
const BLOCK_SAVE_COMMANDS = {
    save_accounting_income_block: 'income',
    save_accounting_expense_management_block: 'expense_management',
    save_accounting_fixed_expenses_block: 'expenses',
    save_accounting_vehicles_block: 'vehicles',
};
function parsePayload(body) {
    const p = body.payload;
    return p && typeof p === 'object' && !Array.isArray(p) ? { ...p } : {};
}
function hasBusinessProfileEdit(ctx) {
    const p = ctx.membership?.permissions ?? [];
    return p.includes('business_profile.edit') || p.includes('client_operations.edit');
}
function parseBusinessProfileCommandPayload(p) {
    const ev = p.expected_version;
    const expected_version = typeof ev === 'number' && Number.isFinite(ev) ? ev : Number(ev);
    if (!Number.isFinite(expected_version))
        throw badRequest('expected_version required');
    const strOrNull = (v) => {
        if (v == null)
            return null;
        const s = String(v).trim();
        return s || null;
    };
    const peakRaw = p.peak_months;
    const peak_months = Array.isArray(peakRaw)
        ? peakRaw.map((x) => Number(x)).filter((n) => !Number.isNaN(n))
        : [];
    const modeRaw = p.business_operation_mode;
    const business_operation_mode = modeRaw == null || modeRaw === '' ? null : modeRaw;
    const custRaw = p.primary_customer_type;
    const primary_customer_type = custRaw == null || custRaw === '' ? null : custRaw;
    let has_business_vehicles;
    if (p.has_business_vehicles !== undefined) {
        has_business_vehicles = Boolean(p.has_business_vehicles);
    }
    return {
        expected_version,
        business_domain: strOrNull(p.business_domain),
        business_activity_description: strOrNull(p.business_activity_description),
        business_address: strOrNull(p.business_address),
        private_address: strOrNull(p.private_address),
        business_operation_mode,
        primary_customer_type,
        is_seasonal_business: Boolean(p.is_seasonal_business),
        peak_months,
        business_open_date: p.business_open_date == null || p.business_open_date === '' ? null : String(p.business_open_date),
        business_close_date: p.business_close_date == null || p.business_close_date === '' ? null : String(p.business_close_date),
        ...(has_business_vehicles !== undefined ? { has_business_vehicles } : {}),
    };
}
export async function executeAccountingCommand(ctx, clientId, body) {
    const t = String(body.type ?? '').trim();
    const payload = parsePayload(body);
    const feesPv = parseFeesPriceChartView(body.fees_price_chart_view);
    const opts = { feesPriceChartView: feesPv };
    const blockKey = BLOCK_SAVE_COMMANDS[t];
    if (blockKey) {
        await saveAccountingBlock(ctx, clientId, blockKey, payload);
        return getClientOperationsCase(ctx, clientId, opts);
    }
    if (t === 'save_accounting_business_profile') {
        if (!hasBusinessProfileEdit(ctx))
            throw forbidden('Insufficient permission');
        const body = parseBusinessProfileCommandPayload(payload);
        const saveResult = await saveClientBusinessProfileSection(ctx, clientId, body);
        if (!saveResult.ok) {
            if (saveResult.code === 'VERSION_CONFLICT') {
                throw conflict(saveResult.message_he, 'VERSION_CONFLICT');
            }
            throw new AppError(400, saveResult.message_he, 'VALIDATION_ERROR', {
                field_errors: saveResult.field_errors ?? [],
            });
        }
        return getClientOperationsCase(ctx, clientId, opts);
    }
    if (t === 'add_expense_management_custom_field') {
        if (!canEditBlock(ctx, 'expense_management'))
            throw forbidden('Insufficient permission');
        await addExpenseManagementCustomFieldApi(ctx, clientId, payload);
        return getClientOperationsCase(ctx, clientId, opts);
    }
    if (t === 'remove_expense_management_custom_field') {
        if (!canEditBlock(ctx, 'expense_management'))
            throw forbidden('Insufficient permission');
        const fieldId = String(payload.field_id ?? '').trim();
        if (!fieldId)
            throw badRequest('field_id required');
        await removeExpenseManagementCustomFieldApi(ctx, clientId, fieldId);
        return getClientOperationsCase(ctx, clientId, opts);
    }
    if (t === 'create_vehicle_fleet_item') {
        if (!canEditBlock(ctx, 'vehicles'))
            throw forbidden('Insufficient permission');
        await createVehicleFleetItem(ctx, clientId, payload);
        return getClientOperationsCase(ctx, clientId, opts);
    }
    if (t === 'update_vehicle_fleet_item') {
        if (!canEditBlock(ctx, 'vehicles'))
            throw forbidden('Insufficient permission');
        const vid = String(payload.vehicle_id ?? '').trim();
        if (!vid)
            throw badRequest('vehicle_id required');
        const { vehicle_id: _omit, ...rest } = payload;
        void _omit;
        await updateVehicleFleetItem(ctx, clientId, vid, rest);
        return getClientOperationsCase(ctx, clientId, opts);
    }
    if (t === 'delete_vehicle_fleet_item') {
        if (!canEditBlock(ctx, 'vehicles'))
            throw forbidden('Insufficient permission');
        const vid = String(payload.vehicle_id ?? '').trim();
        if (!vid)
            throw badRequest('vehicle_id required');
        const { vehicle_id: _omit, ...rest } = payload;
        void _omit;
        await deleteVehicleFleetItem(ctx, clientId, vid, rest);
        return getClientOperationsCase(ctx, clientId, opts);
    }
    throw badRequest(`Unknown accounting command type: ${t || '(empty)'}`);
}
