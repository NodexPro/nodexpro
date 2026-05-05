import type { RequestContext } from '../../shared/context.js';
import { badRequest } from '../../shared/errors.js';
import {
  getClientOperationsCase,
  updateClientOperationsClientProfile,
} from './client-operations.service.js';
import { parseFeesPriceChartView } from './client-fees-tab.service.js';
import { type UpdateClientTaxSettingsBody, updateClientTaxSettings } from './client-tax-settings.service.js';

type UpdateProfilePayload = Parameters<typeof updateClientOperationsClientProfile>[2];

export async function executeClientOperationsProfileCommand(
  ctx: RequestContext,
  clientId: string,
  command: string,
  payload: unknown
) {
  if (command !== 'update_profile') {
    throw badRequest(`Unknown profile command: ${command || '(empty)'}`);
  }
  const body =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as UpdateProfilePayload)
      : ({} as UpdateProfilePayload);
  return updateClientOperationsClientProfile(ctx, clientId, body);
}

export async function executeClientOperationsTaxSettingsCommand(
  ctx: RequestContext,
  clientId: string,
  command: string,
  payload: unknown,
  opts?: { fees_price_chart_view?: unknown }
) {
  if (command !== 'update_tax_settings') {
    throw badRequest(`Unknown tax-settings command: ${command || '(empty)'}`);
  }
  const body =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as UpdateClientTaxSettingsBody)
      : ({} as UpdateClientTaxSettingsBody);
  await updateClientTaxSettings(ctx, clientId, body);
  const feesPv = parseFeesPriceChartView(opts?.fees_price_chart_view);
  return getClientOperationsCase(ctx, clientId, { feesPriceChartView: feesPv });
}
