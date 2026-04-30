import { badRequest } from '../../shared/errors.js';
import { getClientOperationsCase } from './client-operations.service.js';
import { parseFeesPriceChartView } from './client-fees-tab.service.js';
import { updateClientTaxSettings } from './client-tax-settings.service.js';
const ALLOW = {
    update_tax_vat_registration: ['vat_type', 'vat_frequency', 'vat_due_type'],
    update_tax_income_advances: [
        'income_tax_advance_ui_selection',
        'income_tax_advance_enabled',
        'income_tax_advance_percent',
        'income_tax_advance_frequency',
    ],
    update_tax_income_deductions: [
        'income_tax_deductions_ui_selection',
        'income_tax_deductions_enabled',
        'income_tax_deductions_file_number',
        'income_tax_deductions_frequency',
    ],
    update_tax_national_insurance: ['national_insurance_type', 'national_insurance_monthly_amount'],
    update_tax_vat_payment: ['vat_payment_method', 'vat_other_payment_text', 'vat_card_holder_name', 'vat_credit_card'],
    update_tax_income_tax_payment: [
        'income_tax_payment_method',
        'income_tax_other_payment_text',
        'income_tax_card_holder_name',
        'income_tax_credit_card',
    ],
    update_tax_notes: ['notes'],
};
function sliceCommandPayload(type, payload) {
    const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const keys = ALLOW[type];
    const out = {};
    for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(p, k)) {
            out[k] = p[k];
        }
    }
    return out;
}
export async function executeTaxTabCommand(ctx, clientId, body) {
    const t = String(body.type ?? '').trim();
    const allowed = new Set(Object.keys(ALLOW));
    if (!t || !allowed.has(t)) {
        throw badRequest(`Unknown tax command type: ${t || '(empty)'}`);
    }
    const type = t;
    const partial = sliceCommandPayload(type, body.payload);
    await updateClientTaxSettings(ctx, clientId, partial);
    const feesPv = parseFeesPriceChartView(body.fees_price_chart_view);
    const opts = { feesPriceChartView: feesPv };
    return getClientOperationsCase(ctx, clientId, opts);
}
