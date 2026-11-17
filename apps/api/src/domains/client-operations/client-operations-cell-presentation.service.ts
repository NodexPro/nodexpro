/**
 * Client Operations — personal decorative cell formatting persistence.
 * GET loads the current user's period map. Writes go through one atomic bulk RPC.
 */

import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import { assertCanAccessClientFromContext } from './organization-client-access.js';
import {
  CLIENT_OPERATIONS_CELL_PRESENTATION_COMMAND,
  parseClientOperationsCellPresentationWrites,
  toClientOperationsUserCellFormattingMap,
  type ClientOperationsCellPresentation,
  type ClientOperationsCellPresentationWrite,
} from './client-operations-cell-presentation.pure.js';
import { CLIENT_OPERATIONS_REGISTRY_COLUMNS } from './client-operations-registry-presentation.pure.js';
import { loadActiveCustomColumnsExtended } from './client-operations-user-columns-periods.service.js';

function assertQueryError(error: { message?: string } | null, description: string): void {
  if (error) throw new AppError(500, error.message || description, 'SUPABASE_ERROR');
}

function periodKeyFrom(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) throw badRequest('operational_period_key must be YYYY-MM');
  return key;
}

export async function loadClientOperationsCellPresentationsForUser(input: {
  organizationId: string;
  userId: string;
  operationalPeriodKey: string;
}): Promise<Record<string, ClientOperationsCellPresentation>> {
  const periodKey = periodKeyFrom(input.operationalPeriodKey);
  const { data, error } = await supabaseAdmin
    .from('client_operations_cell_presentations')
    .select('row_kind, row_id, column_key, presentation')
    .eq('organization_id', input.organizationId)
    .eq('user_id', input.userId)
    .eq('operational_period_key', periodKey);
  assertQueryError(error, 'Failed to load cell presentations');
  return toClientOperationsUserCellFormattingMap(
    (data ?? []) as Array<{
      row_kind: string;
      row_id: string;
      column_key: string;
      presentation: unknown;
    }>,
  );
}

async function loadEligiblePresentationColumnKeys(organizationId: string): Promise<Set<string>> {
  const extended = await loadActiveCustomColumnsExtended(organizationId);
  return new Set<string>([
    ...CLIENT_OPERATIONS_REGISTRY_COLUMNS.map((column) => column.key).filter((key) => key !== 'folder'),
    ...extended.map((column) => column.key),
  ]);
}

export async function setClientOperationsCellPresentationsBulk(input: {
  ctx: RequestContext;
  organizationId: string;
  operationalPeriodKey: string;
  cells: unknown;
}): Promise<{ applied: number; cells: ClientOperationsCellPresentationWrite[] }> {
  const periodKey = periodKeyFrom(input.operationalPeriodKey);
  let parsed: ClientOperationsCellPresentationWrite[];
  try {
    parsed = parseClientOperationsCellPresentationWrites(input.cells);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : 'invalid cells');
  }

  const eligibleColumns = await loadEligiblePresentationColumnKeys(input.organizationId);
  for (const cell of parsed) {
    if (!eligibleColumns.has(cell.column_key)) {
      throw badRequest(`column_key is not a registry column of this organization: ${cell.column_key}`);
    }
  }

  const clientIds = [
    ...new Set(parsed.filter((cell) => cell.row_kind === 'client').map((cell) => cell.row_id)),
  ];
  for (const clientId of clientIds) {
    await assertCanAccessClientFromContext(input.ctx, clientId);
  }

  const { data, error } = await supabaseAdmin.rpc('apply_client_operations_cell_presentations', {
    p_organization_id: input.organizationId,
    p_user_id: input.ctx.user.id,
    p_operational_period_key: periodKey,
    p_cells: parsed,
  });
  if (error) {
    const message = error.message || 'Failed to apply cell presentations';
    if (error.code === '42501' || /does not belong|not an active member/i.test(message)) {
      throw forbidden('Cell presentation write was rejected by tenant checks');
    }
    if (error.code === '22023' || /invalid|must be|bulk size/i.test(message)) {
      throw badRequest(message);
    }
    throw new AppError(500, message, 'SUPABASE_ERROR');
  }

  const applied = typeof data === 'number' ? data : parsed.length;
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_operations_cell_presentation',
    entityId: `${input.ctx.user.id}:${periodKey}`,
    action: AUDIT_ACTIONS.CLIENT_OPERATIONS_CELL_PRESENTATION_SET,
    payload: {
      command: CLIENT_OPERATIONS_CELL_PRESENTATION_COMMAND,
      operational_period_key: periodKey,
      cell_count: parsed.length,
      applied,
      row_kinds: [...new Set(parsed.map((cell) => cell.row_kind))],
      column_keys: [...new Set(parsed.map((cell) => cell.column_key))],
    },
  });
  return { applied, cells: parsed };
}
