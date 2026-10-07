import type { RequestContext } from '../../shared/context.js';
import { badRequest, forbidden } from '../../shared/errors.js';
import {
  assignClientHandler,
  bulkAssignClientHandler,
  getClientOperationsCase,
  updateClientOperationsClientProfile,
} from './client-operations.service.js';
import { canManageClientHandlerAssignment } from './organization-client-access.js';
import { parseFeesPriceChartView } from './client-fees-tab.service.js';
import { type UpdateClientTaxSettingsBody, updateClientTaxSettings } from './client-tax-settings.service.js';

type UpdateProfilePayload = Parameters<typeof updateClientOperationsClientProfile>[2];

export async function executeClientOperationsProfileCommand(
  ctx: RequestContext,
  clientId: string,
  command: string,
  payload: unknown
) {
  if (command === 'assign_client_handler') {
    if (!canManageClientHandlerAssignment(ctx.membership?.roleCode)) {
      throw forbidden('Only Owner or Admin may assign client handlers', 'CLIENT_HANDLER_ASSIGNMENT_FORBIDDEN');
    }
    const body =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { assigned_handler_user_id?: string | null })
        : {};
    return assignClientHandler(ctx, {
      client_id: clientId,
      assigned_handler_user_id:
        body.assigned_handler_user_id === undefined
          ? null
          : body.assigned_handler_user_id == null || String(body.assigned_handler_user_id).trim() === ''
            ? null
            : String(body.assigned_handler_user_id),
    });
  }
  if (command !== 'update_profile') {
    throw badRequest(`Unknown profile command: ${command || '(empty)'}`);
  }
  const body =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as UpdateProfilePayload)
      : ({} as UpdateProfilePayload);
  return updateClientOperationsClientProfile(ctx, clientId, body);
}

export async function executeBulkAssignClientHandlerCommand(
  ctx: RequestContext,
  payload: unknown,
) {
  const body =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as { client_ids?: unknown; assigned_handler_user_id?: string | null })
      : {};
  const client_ids = Array.isArray(body.client_ids) ? body.client_ids.map((id) => String(id)) : [];
  const result = await bulkAssignClientHandler(ctx, {
    client_ids,
    assigned_handler_user_id:
      body.assigned_handler_user_id === undefined
        ? null
        : body.assigned_handler_user_id == null || String(body.assigned_handler_user_id).trim() === ''
          ? null
          : String(body.assigned_handler_user_id),
  });
  return {
    ...result,
    registry: await import('./client-operations.service.js').then((m) =>
      m.listClientOperationsRegistry(ctx, {}, { materializationCache: false }),
    ),
  };
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
