/**
 * Active-cell formatting selection (presentation only).
 * Not business truth — not persisted.
 */

export type ClientOperationsActiveCell = {
  clientId: string;
  colKey: string;
};

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
}): ClientOperationsActiveCell | null {
  if (!input.active) return null;
  for (const id of input.clientIds) {
    if (id === input.active.clientId) return input.active;
  }
  return null;
}
