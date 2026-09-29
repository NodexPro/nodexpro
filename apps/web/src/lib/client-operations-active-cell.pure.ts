/**
 * Active-cell formatting selection (presentation only).
 * Not business truth — not persisted.
 */

export type ClientOperationsActiveCell = {
  /**
   * Client row identity. Set for real client rows only.
   * Never a fabricated UUID for manual spreadsheet rows.
   */
  clientId?: string;
  /** Manual row identity (`manual:01` …) — set for backend-owned manual rows only. */
  rowKey?: string;
  colKey: string;
};

/** Presentation / formatting storage key: `clientId::col` or `row_key::col`. */
export function clientOperationsPresentationCellKey(cell: {
  clientId?: string | null;
  rowKey?: string | null;
  colKey: string;
}): string {
  const identity = cell.rowKey ?? cell.clientId ?? '';
  return `${identity}::${cell.colKey}`;
}

export function isClientOperationsFormatEligibleColumn(input: {
  columnKey: string;
  cellKind?: string | null;
}): boolean {
  if (input.columnKey === 'folder' || input.cellKind === 'folder') return false;
  return Boolean(input.columnKey);
}

export function shouldClearActiveCellOnPeriodChange(): boolean {
  // Period switch can leave a stale client/column identity that is unsafe to format.
  return true;
}

export function reconcileActiveCellAfterColumnVisibility(input: {
  active: ClientOperationsActiveCell | null;
  hiddenColumnKeys: Iterable<string>;
}): ClientOperationsActiveCell | null {
  if (!input.active) return null;
  for (const key of input.hiddenColumnKeys) {
    if (key === input.active.colKey) return null;
  }
  return input.active;
}

export function reconcileActiveCellAfterRowsChange(input: {
  active: ClientOperationsActiveCell | null;
  clientIds: Iterable<string>;
  manualRowKeys?: Iterable<string>;
}): ClientOperationsActiveCell | null {
  if (!input.active) return null;
  if (input.active.rowKey) {
    for (const key of input.manualRowKeys ?? []) {
      if (key === input.active.rowKey) return input.active;
    }
    return null;
  }
  const clientId = input.active.clientId;
  if (!clientId) return null;
  for (const id of input.clientIds) {
    if (id === clientId) return input.active;
  }
  return null;
}
