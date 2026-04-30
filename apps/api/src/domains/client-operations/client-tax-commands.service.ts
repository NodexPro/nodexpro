/**
 * Tax tab write commands — each maps to a partial UpdateClientTaxSettingsBody, then updateClientTaxSettings (single domain entry).
 * Next evolution: finer validation per command; keep domain rules in client-tax-settings.service.ts only.
 */
import type { RequestContext } from '../../shared/context.js';
import { badRequest } from '../../shared/errors.js';
import { getClientOperationsCase, type ClientOperationsCaseReadOptions } from './client-operations.service.js';
import { parseFeesPriceChartView } from './client-fees-tab.service.js';
import { updateClientTaxSettings, type UpdateClientTaxSettingsBody } from './client-tax-settings.service.js';

export type TaxTabCommandType =
  | 'update_tax_vat_registration'
  | 'update_tax_income_advances'
  | 'update_tax_income_deductions'
  | 'update_tax_national_insurance'
  | 'update_tax_vat_payment'
  | 'update_tax_income_tax_payment'
  | 'update_tax_notes';

const ALLOW: Record<TaxTabCommandType, ReadonlyArray<keyof UpdateClientTaxSettingsBody>> = {
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

function sliceCommandPayload(
  type: TaxTabCommandType,
  payload: Record<string, unknown> | null | undefined
): UpdateClientTaxSettingsBody {
  const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const keys = ALLOW[type];
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(p, k)) {
      out[k as string] = (p as Record<string, unknown>)[k as string];
    }
  }
  return out as UpdateClientTaxSettingsBody;
}

export async function executeTaxTabCommand(
  ctx: RequestContext,
  clientId: string,
  body: {
    type?: string;
    payload?: Record<string, unknown>;
    fees_price_chart_view?: unknown;
  }
): Promise<Awaited<ReturnType<typeof getClientOperationsCase>>> {
  const t = String(body.type ?? '').trim();
  const allowed = new Set<string>(Object.keys(ALLOW));
  if (!t || !allowed.has(t)) {
    throw badRequest(`Unknown tax command type: ${t || '(empty)'}`);
  }
  const type = t as TaxTabCommandType;
  const partial = sliceCommandPayload(type, body.payload);
  await updateClientTaxSettings(ctx, clientId, partial);
  const feesPv = parseFeesPriceChartView(body.fees_price_chart_view);
  const opts: ClientOperationsCaseReadOptions = { feesPriceChartView: feesPv };
  return getClientOperationsCase(ctx, clientId, opts);
}
