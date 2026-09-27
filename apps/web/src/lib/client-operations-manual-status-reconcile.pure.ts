/**
 * Manual-status presentation overlays — prevent stale aggregates from wiping
 * newer optimistic/confirmed paint for the same org+period+client+column.
 * Not business truth; short-lived FE reconciliation only.
 */

import {
  isManualStatusPaintInFlight,
  type ManualStatusPaintIntent,
  type ManualStatusPaintSlot,
} from './client-operations-manual-status-paint.pure.js';

export type ManualStatusOverlay = {
  status: ManualStatusPaintIntent;
  generation: number;
};

export type ManualStatusCapableRow = {
  client_id: string;
  manual_cell_statuses?: Record<
    string,
    {
      status: ManualStatusPaintIntent;
      presentation_token?: ManualStatusPaintIntent;
      allowed_statuses: Array<'ready' | 'sent_for_approval' | 'completed' | 'clear'>;
      operational_square_count: number;
    }
  >;
};

export function manualStatusPaintKey(
  clientId: string,
  columnKey: string,
  periodKey: string,
): string {
  return `${clientId}:${columnKey}:${periodKey}`;
}

export function parseManualStatusPaintKey(
  key: string,
): { clientId: string; columnKey: string; periodKey: string } | null {
  const parts = key.split(':');
  if (parts.length < 3) return null;
  const periodKey = parts[parts.length - 1] ?? '';
  const columnKey = parts[parts.length - 2] ?? '';
  const clientId = parts.slice(0, -2).join(':');
  if (!clientId || !columnKey || !periodKey) return null;
  return { clientId, columnKey, periodKey };
}

export function isManualStatusPaintBusy(
  slots: Map<string, ManualStatusPaintSlot>,
  key: string,
): boolean {
  if (isManualStatusPaintInFlight(slots, key)) return true;
  const slot = slots.get(key);
  return slot?.latestIntent !== undefined;
}

export function setManualStatusOverlay(
  overlays: Map<string, ManualStatusOverlay>,
  key: string,
  status: ManualStatusPaintIntent,
  generation: number,
): void {
  overlays.set(key, { status, generation });
}

export function clearManualStatusOverlays(overlays: Map<string, ManualStatusOverlay>): void {
  overlays.clear();
}

function readRowStatus(
  rows: ManualStatusCapableRow[],
  clientId: string,
  columnKey: string,
): ManualStatusPaintIntent | undefined {
  const row = rows.find((r) => r.client_id === clientId);
  if (!row) return undefined;
  return row.manual_cell_statuses?.[columnKey]?.status ?? null;
}

/**
 * Drop overlays only when the incoming aggregate already carries the same status
 * and the cell is not busy. Stale older aggregates that disagree keep the overlay.
 */
export function pruneOverlaysMatchingAggregate(
  overlays: Map<string, ManualStatusOverlay>,
  incomingRows: ManualStatusCapableRow[],
  viewedPeriodKey: string,
  slots: Map<string, ManualStatusPaintSlot>,
): void {
  const viewed = String(viewedPeriodKey ?? '').trim();
  for (const [key, overlay] of [...overlays.entries()]) {
    if (isManualStatusPaintBusy(slots, key)) continue;
    const parsed = parseManualStatusPaintKey(key);
    if (!parsed) continue;
    if (viewed && parsed.periodKey !== viewed) continue;
    const incoming = readRowStatus(incomingRows, parsed.clientId, parsed.columnKey);
    if (incoming === undefined) continue;
    if (incoming === overlay.status) overlays.delete(key);
  }
}

export function mergeRowsWithManualStatusOverlays<T extends ManualStatusCapableRow>(
  rows: T[],
  overlays: Map<string, ManualStatusOverlay>,
  viewedPeriodKey: string,
): T[] {
  if (!overlays.size) return rows;
  const viewed = String(viewedPeriodKey ?? '').trim();
  let changed = false;
  const next = rows.map((row) => {
    let statuses = row.manual_cell_statuses;
    let rowChanged = false;
    for (const [key, overlay] of overlays) {
      const parsed = parseManualStatusPaintKey(key);
      if (!parsed || parsed.clientId !== row.client_id) continue;
      if (viewed && parsed.periodKey !== viewed) continue;
      const existing = statuses?.[parsed.columnKey];
      const currentStatus = existing?.status ?? null;
      if (currentStatus === overlay.status) continue;
      rowChanged = true;
      changed = true;
      const base = existing ?? {
        status: null as ManualStatusPaintIntent,
        presentation_token: null as ManualStatusPaintIntent,
        allowed_statuses: ['ready', 'sent_for_approval', 'completed'] as Array<
          'ready' | 'sent_for_approval' | 'completed' | 'clear'
        >,
        operational_square_count: 0,
      };
      statuses = {
        ...(statuses ?? {}),
        [parsed.columnKey]: {
          ...base,
          status: overlay.status,
          presentation_token: overlay.status,
          allowed_statuses:
            overlay.status == null
              ? base.allowed_statuses.filter((s) => s !== 'clear')
              : Array.from(new Set([...base.allowed_statuses, 'clear' as const])),
        },
      };
    }
    if (!rowChanged) return row;
    return { ...row, manual_cell_statuses: statuses };
  });
  return changed ? next : rows;
}

export function reconcileManualStatusRows<T extends ManualStatusCapableRow>(input: {
  rows: T[];
  overlays: Map<string, ManualStatusOverlay>;
  slots: Map<string, ManualStatusPaintSlot>;
  viewedPeriodKey: string;
}): T[] {
  pruneOverlaysMatchingAggregate(
    input.overlays,
    input.rows,
    input.viewedPeriodKey,
    input.slots,
  );
  return mergeRowsWithManualStatusOverlays(input.rows, input.overlays, input.viewedPeriodKey);
}
