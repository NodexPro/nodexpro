import { badRequest } from '../../shared/errors.js';
import { getClientOperationsCase, updateClientOperationsClientProfile, } from './client-operations.service.js';
import { parseFeesPriceChartView } from './client-fees-tab.service.js';
import { updateClientTaxSettings } from './client-tax-settings.service.js';
export async function executeClientOperationsProfileCommand(ctx, clientId, command, payload) {
    if (command !== 'update_profile') {
        throw badRequest(`Unknown profile command: ${command || '(empty)'}`);
    }
    const body = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : {};
    return updateClientOperationsClientProfile(ctx, clientId, body);
}
export async function executeClientOperationsTaxSettingsCommand(ctx, clientId, command, payload, opts) {
    if (command !== 'update_tax_settings') {
        throw badRequest(`Unknown tax-settings command: ${command || '(empty)'}`);
    }
    const body = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : {};
    await updateClientTaxSettings(ctx, clientId, body);
    const feesPv = parseFeesPriceChartView(opts?.fees_price_chart_view);
    return getClientOperationsCase(ctx, clientId, { feesPriceChartView: feesPv });
}
