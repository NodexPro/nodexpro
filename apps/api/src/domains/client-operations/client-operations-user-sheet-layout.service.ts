/**
 * Client Operations — personal hidden columns + system column widths.
 * GET is read-only. Writes are named commands with atomic RPCs.
 */

import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import {
  CLIENT_OPERATIONS_SETUP_WARNING_DISMISSED_COMMAND,
  CLIENT_OPERATIONS_USER_HIDDEN_COLUMNS_COMMAND,
  CLIENT_OPERATIONS_USER_SYSTEM_COLUMN_WIDTH_COMMAND,
  parseClientOperationsSystemColumnWidthWrite,
  parseSetupWarningDismissedFlag,
  sanitizeClientOperationsHiddenColumnKeys,
  sanitizeClientOperationsSystemColumnWidths,
} from './client-operations-user-sheet-layout.pure.js';
import { formatClientsAddedGeneration } from './client-operations-reporting-setup-gaps.pure.js';
import {
  CLIENT_OPERATIONS_REGISTRY_COLUMNS,
  isSystemRegistryColumnKey,
} from './client-operations-registry-presentation.pure.js';
import { loadActiveCustomColumnsExtended } from './client-operations-user-columns-periods.service.js';

function assertQueryError(error: { message?: string } | null, description: string): void {
  if (error) throw new AppError(500, error.message || description, 'SUPABASE_ERROR');
}

function mapRpcError(error: { message?: string; code?: string } | null, fallback: string): never {
  const message = error?.message || fallback;
  if (error?.code === '42501' || /not an active member/i.test(message)) {
    throw forbidden('Sheet layout write was rejected by tenant checks');
  }
  if (error?.code === '22023' || /invalid|must be|bulk size|required/i.test(message)) {
    throw badRequest(message);
  }
  throw new AppError(500, message, 'SUPABASE_ERROR');
}

const SYSTEM_COLUMN_KEYS = new Set(CLIENT_OPERATIONS_REGISTRY_COLUMNS.map((column) => column.key));

async function loadEligibleHiddenColumnKeys(organizationId: string): Promise<Set<string>> {
  const extended = await loadActiveCustomColumnsExtended(organizationId);
  return new Set<string>([
    ...CLIENT_OPERATIONS_REGISTRY_COLUMNS.map((column) => column.key),
    ...extended.map((column) => column.key),
  ]);
}

export async function loadOrganizationClientsAddedGeneration(organizationId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('clients_added_generation')
    .eq('id', organizationId)
    .maybeSingle();
  assertQueryError(error, 'Failed to load clients-added generation');
  return formatClientsAddedGeneration(
    (data as { clients_added_generation?: unknown } | null)?.clients_added_generation,
  );
}

export async function loadClientOperationsUserSheetLayoutForUser(input: {
  organizationId: string;
  userId: string;
}): Promise<{
  hidden_column_keys: string[];
  system_column_widths: Record<string, number>;
  setup_warning_dismissed_clients_added_token: string;
}> {
  const { data, error } = await supabaseAdmin
    .from('client_operations_user_sheet_preferences')
    .select('hidden_column_keys, system_column_widths, setup_warning_dismissed_clients_added_token')
    .eq('organization_id', input.organizationId)
    .eq('user_id', input.userId)
    .maybeSingle();
  assertQueryError(error, 'Failed to load user sheet preferences');
  const row = data as {
    hidden_column_keys?: unknown;
    system_column_widths?: unknown;
    setup_warning_dismissed_clients_added_token?: unknown;
  } | null;
  const eligible = await loadEligibleHiddenColumnKeys(input.organizationId);
  let hidden_column_keys: string[] = [];
  try {
    hidden_column_keys = sanitizeClientOperationsHiddenColumnKeys(row?.hidden_column_keys ?? [], eligible);
  } catch {
    hidden_column_keys = [];
  }
  return {
    hidden_column_keys,
    system_column_widths: sanitizeClientOperationsSystemColumnWidths(
      row?.system_column_widths ?? {},
      SYSTEM_COLUMN_KEYS,
    ),
    setup_warning_dismissed_clients_added_token: String(
      row?.setup_warning_dismissed_clients_added_token ?? '',
    ).trim(),
  };
}

export async function setClientOperationsUserHiddenColumns(input: {
  ctx: RequestContext;
  organizationId: string;
  columnKeys: unknown;
}): Promise<{ hidden_column_keys: string[] }> {
  const eligible = await loadEligibleHiddenColumnKeys(input.organizationId);
  let hidden: string[];
  try {
    hidden = sanitizeClientOperationsHiddenColumnKeys(input.columnKeys, eligible);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'invalid column_keys');
  }
  const { error } = await supabaseAdmin.rpc('apply_client_operations_user_hidden_columns', {
    p_organization_id: input.organizationId,
    p_user_id: input.ctx.user.id,
    p_hidden_column_keys: hidden,
  });
  if (error) mapRpcError(error, 'Failed to save hidden columns');
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_operations_user_sheet_preferences',
    entityId: input.ctx.user.id,
    action: AUDIT_ACTIONS.CLIENT_OPERATIONS_USER_HIDDEN_COLUMNS_SET,
    payload: {
      command: CLIENT_OPERATIONS_USER_HIDDEN_COLUMNS_COMMAND,
      column_keys: hidden,
      column_count: hidden.length,
    },
  });
  return { hidden_column_keys: hidden };
}

export async function setClientOperationsUserSystemColumnWidth(input: {
  ctx: RequestContext;
  organizationId: string;
  columnKey: unknown;
  widthPx: unknown;
}): Promise<{ column_key: string; width_px: number }> {
  let parsed: { column_key: string; width_px: number };
  try {
    parsed = parseClientOperationsSystemColumnWidthWrite({
      columnKey: input.columnKey,
      widthPx: input.widthPx,
      systemColumnKeys: SYSTEM_COLUMN_KEYS,
    });
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'invalid system column width');
  }
  if (!isSystemRegistryColumnKey(parsed.column_key)) {
    throw badRequest('column_key is not a system registry column');
  }
  const { error } = await supabaseAdmin.rpc('apply_client_operations_user_system_column_width', {
    p_organization_id: input.organizationId,
    p_user_id: input.ctx.user.id,
    p_column_key: parsed.column_key,
    p_width_px: parsed.width_px,
  });
  if (error) mapRpcError(error, 'Failed to save system column width');
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_operations_user_sheet_preferences',
    entityId: `${input.ctx.user.id}:${parsed.column_key}`,
    action: AUDIT_ACTIONS.CLIENT_OPERATIONS_USER_SYSTEM_COLUMN_WIDTH_SET,
    payload: {
      command: CLIENT_OPERATIONS_USER_SYSTEM_COLUMN_WIDTH_COMMAND,
      column_key: parsed.column_key,
      width_px: parsed.width_px,
    },
  });
  return parsed;
}

export async function setClientOperationsSetupWarningDismissed(input: {
  ctx: RequestContext;
  organizationId: string;
  dismissed: unknown;
}): Promise<{ dismissed: boolean; clients_added_token: string }> {
  let dismissed: boolean;
  try {
    dismissed = parseSetupWarningDismissedFlag(input.dismissed);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'dismissed must be a boolean');
  }
  let token = '';
  if (dismissed) {
    token = await loadOrganizationClientsAddedGeneration(input.organizationId);
    if (!token) token = '0';
  }
  const { error } = await supabaseAdmin.rpc('apply_client_operations_setup_warning_dismissed', {
    p_organization_id: input.organizationId,
    p_user_id: input.ctx.user.id,
    p_clients_added_token: token,
  });
  if (error) mapRpcError(error, 'Failed to save setup warning preference');
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_operations_user_sheet_preferences',
    entityId: input.ctx.user.id,
    action: AUDIT_ACTIONS.CLIENT_OPERATIONS_SETUP_WARNING_DISMISSED_SET,
    payload: {
      command: CLIENT_OPERATIONS_SETUP_WARNING_DISMISSED_COMMAND,
      dismissed,
      clients_added_token: token,
    },
  });
  return { dismissed, clients_added_token: token };
}
