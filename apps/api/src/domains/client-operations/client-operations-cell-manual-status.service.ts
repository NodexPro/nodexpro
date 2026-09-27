/**
 * Client Operations — manual Excel cell status persistence + eligibility attach.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import {
  CLIENT_OPERATIONS_MANUAL_STATUS_PAINT_MODES,
  countMaterialOperationalSquares,
  countNiDeductionsOperationalSquares,
  isClientOperationsManualStatusPaintableColumnKey,
  isValidClientOperationsManualCellStatus,
  resolveAllowedManualStatuses,
  type ClientOperationsManualCellStatus,
  type ClientOperationsManualStatusPaintMode,
} from './client-operations-cell-manual-status.pure.js';
import { periodKeyFrom } from './client-operations-user-columns-periods.service.js';
import { loadPeriodApplicabilitySnapshots } from './client-operations-operational-period.service.js';

export type ManualCellStatusCapability = {
  status: ClientOperationsManualCellStatus | null;
  presentation_token: ClientOperationsManualCellStatus | null;
  allowed_statuses: ClientOperationsManualStatusPaintMode[];
  operational_square_count: number;
};

function assertQueryError(error: { message?: string } | null, description: string): void {
  if (error) throw new AppError(500, error.message || description, 'SUPABASE_ERROR');
}

export async function loadManualCellStatusesForPeriod(input: {
  organizationId: string;
  operationalPeriodKey: string;
  clientIds: string[];
}): Promise<Map<string, ClientOperationsManualCellStatus>> {
  const out = new Map<string, ClientOperationsManualCellStatus>();
  if (!input.clientIds.length) return out;
  const periodKey = periodKeyFrom(input.operationalPeriodKey);
  const { data, error } = await supabaseAdmin
    .from('client_operations_cell_manual_statuses')
    .select('client_id, column_key, status')
    .eq('organization_id', input.organizationId)
    .eq('operational_period_key', periodKey)
    .in('client_id', input.clientIds);
  assertQueryError(error, 'Failed to load cell manual statuses');
  for (const row of (data ?? []) as Array<{
    client_id: string;
    column_key: string;
    status: string;
  }>) {
    if (!isValidClientOperationsManualCellStatus(row.status)) continue;
    out.set(`${row.client_id}:${row.column_key}`, row.status);
  }
  return out;
}

export function buildManualStatusCapabilitiesForRow(input: {
  clientId: string;
  columnKeys: string[];
  customColumnKeys: Set<string>;
  statuses: Map<string, ClientOperationsManualCellStatus>;
  materialSquareCount: number;
  niDeductionsSquareCount: number;
  incomeTaxDeductionsSquareCount: number;
  annualApplicable: boolean;
  capitalApplicable: boolean;
}): Record<string, ManualCellStatusCapability> {
  const result: Record<string, ManualCellStatusCapability> = {};
  for (const columnKey of input.columnKeys) {
    const isCustom = input.customColumnKeys.has(columnKey);
    if (!isCustom && !isClientOperationsManualStatusPaintableColumnKey(columnKey)) continue;

    let squares = 0;
    if (columnKey === 'material_brought') {
      if (!input.materialSquareCount) continue;
      squares = input.materialSquareCount;
    }
    else if (columnKey === 'national_insurance_deductions') {
      if (!input.niDeductionsSquareCount) continue;
      squares = input.niDeductionsSquareCount;
    } else if (columnKey === 'income_tax_deductions') {
      if (input.incomeTaxDeductionsSquareCount < 1) continue;
      squares = 1;
    } else if (columnKey === 'annual_report') {
      if (!input.annualApplicable) continue;
      squares = 0;
    } else if (columnKey === 'capital_declaration') {
      if (!input.capitalApplicable) continue;
      squares = 0;
    } else squares = 0; // custom / ordinary

    const current = input.statuses.get(`${input.clientId}:${columnKey}`) ?? null;
    const allowed = resolveAllowedManualStatuses({
      columnKey,
      operationalSquareCount: squares,
      currentStatus: current,
      isCustomColumn: isCustom,
    });
    if (!allowed.length && !current) continue;
    result[columnKey] = {
      status: current,
      presentation_token: current,
      allowed_statuses: allowed,
      operational_square_count: squares,
    };
  }
  return result;
}

export function manualStatusPaintModesForAggregate() {
  return CLIENT_OPERATIONS_MANUAL_STATUS_PAINT_MODES.map((m) => ({ ...m }));
}

export async function resolveAllowedManualStatusesForWrite(input: {
  organizationId: string;
  clientId: string;
  operationalPeriodKey: string;
  columnKey: string;
  isCustomColumn: boolean;
}): Promise<ClientOperationsManualStatusPaintMode[]> {
  const periodKey = periodKeyFrom(input.operationalPeriodKey);
  const statuses = await loadManualCellStatusesForPeriod({
    organizationId: input.organizationId,
    operationalPeriodKey: periodKey,
    clientIds: [input.clientId],
  });
  const current = statuses.get(`${input.clientId}:${input.columnKey}`) ?? null;

  if (input.isCustomColumn) {
    return resolveAllowedManualStatuses({
      columnKey: input.columnKey,
      operationalSquareCount: 0,
      currentStatus: current,
      isCustomColumn: true,
    });
  }

  if (!isClientOperationsManualStatusPaintableColumnKey(input.columnKey)) return [];

  if (input.columnKey === 'annual_report' || input.columnKey === 'capital_declaration') {
    // Ordinary dates: always ≤1 square semantics when column is shown as applicable by FE/aggregate.
    return resolveAllowedManualStatuses({
      columnKey: input.columnKey,
      operationalSquareCount: 0,
      currentStatus: current,
      isCustomColumn: false,
    });
  }

  if (input.columnKey === 'income_tax_deductions') {
    return resolveAllowedManualStatuses({
      columnKey: input.columnKey,
      operationalSquareCount: 1,
      currentStatus: current,
      isCustomColumn: false,
    });
  }

  if (input.columnKey === 'material_brought') {
    const snaps = await loadPeriodApplicabilitySnapshots({
      organizationId: input.organizationId,
      operationalPeriodKey: periodKey,
      clientIds: [input.clientId],
    });
    const snap = snaps.get(input.clientId);
    const squares = countMaterialOperationalSquares({
      vatApplicable: Boolean(snap?.vat_applicable),
      incomeTaxAdvanceApplicable: Boolean(snap?.income_tax_advance_applicable),
      payrollApplicable: Boolean(snap?.payroll_applicable),
    });
    return resolveAllowedManualStatuses({
      columnKey: input.columnKey,
      operationalSquareCount: squares,
      currentStatus: current,
      isCustomColumn: false,
    });
  }

  if (input.columnKey === 'national_insurance_deductions') {
    const snaps = await loadPeriodApplicabilitySnapshots({
      organizationId: input.organizationId,
      operationalPeriodKey: periodKey,
      clientIds: [input.clientId],
    });
    const snap = snaps.get(input.clientId);
    const applicable = Boolean(snap?.national_insurance_deductions_applicable);
    const squares = countNiDeductionsOperationalSquares({
      applicable,
      form102Applicable: applicable,
      form100Applicable: applicable,
      form126Applicable: applicable,
    });
    if (!squares) return current ? (['clear'] as ClientOperationsManualStatusPaintMode[]) : [];
    return resolveAllowedManualStatuses({
      columnKey: input.columnKey,
      operationalSquareCount: squares,
      currentStatus: current,
      isCustomColumn: false,
    });
  }

  return [];
}

export async function setClientOperationsCellManualStatus(input: {
  ctx: RequestContext;
  organizationId: string;
  clientId: string;
  operationalPeriodKey: string;
  columnKey: string;
  status: ClientOperationsManualCellStatus | null;
  allowedStatuses: ClientOperationsManualStatusPaintMode[];
}): Promise<void> {
  const periodKey = periodKeyFrom(input.operationalPeriodKey);
  const columnKey = String(input.columnKey ?? '').trim();
  if (!columnKey) throw badRequest('column_key is required');

  if (input.status == null) {
    if (!input.allowedStatuses.includes('clear')) {
      throw forbidden('Clear status is not allowed for this cell');
    }
    const { error } = await supabaseAdmin
      .from('client_operations_cell_manual_statuses')
      .delete()
      .eq('organization_id', input.organizationId)
      .eq('client_id', input.clientId)
      .eq('operational_period_key', periodKey)
      .eq('column_key', columnKey);
    assertQueryError(error, 'Failed to clear cell manual status');
  } else {
    if (!input.allowedStatuses.includes(input.status)) {
      throw forbidden('Requested manual status is not allowed for this cell');
    }
    const { error } = await supabaseAdmin.from('client_operations_cell_manual_statuses').upsert(
      {
        organization_id: input.organizationId,
        client_id: input.clientId,
        operational_period_key: periodKey,
        column_key: columnKey,
        status: input.status,
        updated_at: new Date().toISOString(),
        updated_by: input.ctx.user.id,
      },
      { onConflict: 'organization_id,client_id,operational_period_key,column_key' },
    );
    assertQueryError(error, 'Failed to set cell manual status');
  }

  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_operations_cell_manual_status',
    entityId: `${input.clientId}:${columnKey}`,
    action: AUDIT_ACTIONS.CLIENT_OPERATIONS_CELL_MANUAL_STATUS_SET,
    payload: {
      client_id: input.clientId,
      column_key: columnKey,
      operational_period_key: periodKey,
      status: input.status,
    },
  });
}

export {
  countMaterialOperationalSquares,
  countNiDeductionsOperationalSquares,
  isValidClientOperationsManualCellStatus,
};
