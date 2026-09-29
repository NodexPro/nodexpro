/**
 * Client Operations — manual spreadsheet rows (period-scoped free text, 5 slots).
 * READ path is read-only. First-touch carry-forward is a named command + atomic RPC.
 */
import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import {
  formatClientOperationsManualRowSlot,
  isClientOperationsManualFreeTextColumnKey,
  isMeaningfulManualCellValue,
  materializeClientOperationsManualRows,
  parseClientOperationsManualRowSlot,
  type ClientOperationsManualRegistryRow,
  type ClientOperationsManualRowSlot,
} from './client-operations-manual-rows.pure.js';

export const CLIENT_OPERATIONS_MANUAL_CELL_VALUE_MAX_LENGTH = 4000;

function assertQueryError(error: { message?: string } | null, fallback: string): void {
  if (!error) return;
  throw new AppError(500, error.message || fallback, 'SUPABASE_ERROR');
}

function periodKeyFrom(value: unknown): string {
  const key = String(value ?? '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) {
    throw badRequest('operational_period_key must be YYYY-MM');
  }
  return key;
}

export async function isManualRowsPeriodSetupComplete(
  organizationId: string,
  operationalPeriodKey: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('client_operations_manual_rows_period_setup')
    .select('operational_period_key')
    .eq('organization_id', organizationId)
    .eq('operational_period_key', operationalPeriodKey)
    .maybeSingle();
  assertQueryError(error, 'Failed to read manual rows period setup');
  return Boolean(data);
}

async function loadManualRowValuesForPeriod(input: {
  organizationId: string;
  operationalPeriodKey: string;
}): Promise<Array<{ slot: number; column_key: string; value_text: string }>> {
  const { data, error } = await supabaseAdmin
    .from('client_operations_manual_row_cell_values')
    .select('manual_row_slot, column_key, value_text')
    .eq('organization_id', input.organizationId)
    .eq('operational_period_key', input.operationalPeriodKey);
  assertQueryError(error, 'Failed to load manual row cell values');
  return (data ?? []).map((row) => ({
    slot: Number((row as { manual_row_slot: number }).manual_row_slot),
    column_key: String((row as { column_key: string }).column_key ?? ''),
    value_text: String((row as { value_text: string }).value_text ?? ''),
  }));
}

async function upsertManualRowCellValue(input: {
  organizationId: string;
  operationalPeriodKey: string;
  slot: ClientOperationsManualRowSlot;
  columnKey: string;
  valueText: string;
  actorUserId: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const trimmed = input.valueText.trim();
  if (!trimmed) {
    const { error } = await supabaseAdmin
      .from('client_operations_manual_row_cell_values')
      .delete()
      .eq('organization_id', input.organizationId)
      .eq('operational_period_key', input.operationalPeriodKey)
      .eq('manual_row_slot', input.slot)
      .eq('column_key', input.columnKey);
    assertQueryError(error, 'Failed to clear manual row cell value');
    return;
  }
  if (trimmed.length > CLIENT_OPERATIONS_MANUAL_CELL_VALUE_MAX_LENGTH) {
    throw badRequest(`value exceeds ${CLIENT_OPERATIONS_MANUAL_CELL_VALUE_MAX_LENGTH} characters`);
  }
  const { error } = await supabaseAdmin.from('client_operations_manual_row_cell_values').upsert(
    {
      organization_id: input.organizationId,
      operational_period_key: input.operationalPeriodKey,
      manual_row_slot: input.slot,
      column_key: input.columnKey,
      value_text: trimmed,
      updated_at: now,
      updated_by: input.actorUserId,
    },
    { onConflict: 'organization_id,operational_period_key,manual_row_slot,column_key' },
  );
  assertQueryError(error, 'Failed to upsert manual row cell value');
}

/**
 * Named-command first-touch only. Uses atomic RPC (claim marker + previous-period copy).
 * Returns true when this call performed initialization.
 */
export async function initializeManualRowsForPeriod(input: {
  ctx: RequestContext;
  organizationId: string;
  operationalPeriodKey: string;
}): Promise<{ initialized: boolean }> {
  const periodKey = periodKeyFrom(input.operationalPeriodKey);
  const { data, error } = await supabaseAdmin.rpc(
    'initialize_client_operations_manual_rows_for_period',
    {
      p_organization_id: input.organizationId,
      p_operational_period_key: periodKey,
      p_actor_user_id: input.ctx.user.id,
    },
  );
  assertQueryError(error, 'Failed to initialize manual rows for period');
  const initialized = data === true;
  if (initialized) {
    await writeAudit({
      organizationId: input.organizationId,
      actorUserId: input.ctx.user.id,
      moduleCode: 'client-operations',
      entityType: 'client_operations_manual_rows_period_setup',
      entityId: `${input.organizationId}:${periodKey}`,
      action: AUDIT_ACTIONS.CLIENT_OPERATIONS_MANUAL_ROWS_PERIOD_INITIALIZED,
      payload: { operational_period_key: periodKey },
    });
  }
  return { initialized };
}

/** Aggregate READ only — never writes setup markers or carry-forward copies. */
export async function buildManualRowsForRegistryAggregate(input: {
  organizationId: string;
  operationalPeriodKey: string;
  columnKeys: readonly string[];
  searchQ?: string | null;
}): Promise<ClientOperationsManualRegistryRow[]> {
  const periodKey = periodKeyFrom(input.operationalPeriodKey);
  const values = await loadManualRowValuesForPeriod({
    organizationId: input.organizationId,
    operationalPeriodKey: periodKey,
  });
  const valuesBySlotColumn = new Map<string, string>();
  for (const row of values) {
    let slot: ClientOperationsManualRowSlot;
    try {
      slot = formatClientOperationsManualRowSlot(row.slot);
    } catch {
      continue;
    }
    if (!isClientOperationsManualFreeTextColumnKey(row.column_key)) continue;
    valuesBySlotColumn.set(`${slot}:${row.column_key}`, row.value_text);
  }
  return materializeClientOperationsManualRows({
    columnKeys: input.columnKeys,
    valuesBySlotColumn,
    searchQ: input.searchQ,
  });
}

/**
 * Aggregate signal for editors: first-touch init is needed (no hidden GET write).
 * Null when viewer or already initialized.
 */
export async function buildManualRowsPeriodSetupForAggregate(input: {
  organizationId: string;
  operationalPeriodKey: string;
  canEdit: boolean;
}): Promise<{ needed: boolean; operational_period_key: string } | null> {
  if (!input.canEdit) return null;
  const periodKey = periodKeyFrom(input.operationalPeriodKey);
  if (await isManualRowsPeriodSetupComplete(input.organizationId, periodKey)) return null;
  return { needed: true, operational_period_key: periodKey };
}

export async function setClientOperationsManualRowCellValue(input: {
  ctx: RequestContext;
  organizationId: string;
  operationalPeriodKey: string;
  manualRowSlot: unknown;
  columnKey: string;
  value: unknown;
  eligibleColumnKeys: ReadonlySet<string>;
}): Promise<void> {
  const periodKey = periodKeyFrom(input.operationalPeriodKey);
  let slot: ClientOperationsManualRowSlot;
  try {
    slot = parseClientOperationsManualRowSlot(input.manualRowSlot);
  } catch {
    throw badRequest('manual_row_slot must be an integer 1..5');
  }
  const columnKey = String(input.columnKey ?? '').trim();
  if (!columnKey) throw badRequest('column_key is required');
  if (!isClientOperationsManualFreeTextColumnKey(columnKey)) {
    throw badRequest('column_key is not eligible for manual row free text');
  }
  if (!input.eligibleColumnKeys.has(columnKey)) {
    throw forbidden('column_key is not part of the Client Operations registry table');
  }

  // Write path may initialize (named command chain) — never aggregate GET.
  if (!(await isManualRowsPeriodSetupComplete(input.organizationId, periodKey))) {
    await initializeManualRowsForPeriod({
      ctx: input.ctx,
      organizationId: input.organizationId,
      operationalPeriodKey: periodKey,
    });
  }

  const beforeRows = await loadManualRowValuesForPeriod({
    organizationId: input.organizationId,
    operationalPeriodKey: periodKey,
  });
  const before =
    beforeRows.find((r) => r.slot === slot && r.column_key === columnKey)?.value_text ?? '';
  const next = input.value == null ? '' : String(input.value);
  if (next.length > CLIENT_OPERATIONS_MANUAL_CELL_VALUE_MAX_LENGTH) {
    throw badRequest(`value exceeds ${CLIENT_OPERATIONS_MANUAL_CELL_VALUE_MAX_LENGTH} characters`);
  }

  await upsertManualRowCellValue({
    organizationId: input.organizationId,
    operationalPeriodKey: periodKey,
    slot,
    columnKey,
    valueText: next,
    actorUserId: input.ctx.user.id,
  });

  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_operations_manual_row_cell_values',
    entityId: `${input.organizationId}:${periodKey}:${slot}:${columnKey}`,
    action: AUDIT_ACTIONS.CLIENT_OPERATIONS_MANUAL_ROW_CELL_VALUE_SET,
    payload: {
      operational_period_key: periodKey,
      manual_row_slot: slot,
      column_key: columnKey,
      before,
      after: next.trim(),
    },
  });
}

export { isMeaningfulManualCellValue };
