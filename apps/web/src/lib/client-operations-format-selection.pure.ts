/**
 * Presentation-only format selection (single cell or rectangle).
 * Decorative fill must not cover system obligation colours.
 */

import type { ClientOperationsActiveCell } from './client-operations-active-cell.pure.js';
import { clientOperationsPresentationCellKey } from './client-operations-active-cell.pure.js';

export type ClientOperationsFormatRange = {
  anchor: ClientOperationsActiveCell;
  focus: ClientOperationsActiveCell;
};

const SYSTEM_FILL_TONES = new Set([
  'overdue',
  'urgent',
  'warning',
  'submitted',
  'payment_outstanding',
  'payment_unknown',
]);

const SYSTEM_FILL_CHROME = new Set(['action_required', 'filed_unpaid', 'filed_paid']);

export function clientOperationsCellAllowsDecorativeFill(input: {
  columnKey: string;
  cellKind?: string | null;
  manualStatusToken?: string | null;
  reportingTone?: string | null;
  filingChrome?: string | null;
  systemStatusLocked?: boolean;
}): boolean {
  if (input.columnKey === 'folder' || input.cellKind === 'folder') return false;
  if (input.manualStatusToken) return false;
  if (input.systemStatusLocked) return false;
  if (input.reportingTone && SYSTEM_FILL_TONES.has(input.reportingTone)) return false;
  if (input.filingChrome && SYSTEM_FILL_CHROME.has(input.filingChrome)) return false;
  return true;
}

function identityOf(cell: ClientOperationsActiveCell): string {
  return cell.rowKey ?? cell.clientId ?? '';
}

export function listClientOperationsFormatSelectionKeys(input: {
  range: ClientOperationsFormatRange | null;
  focused: ClientOperationsActiveCell | null;
  rowIds: readonly string[];
  columnKeys: readonly string[];
}): string[] {
  const focus = input.range?.focus ?? input.focused;
  const anchor = input.range?.anchor ?? input.focused;
  if (!focus) return [];
  if (!anchor || (identityOf(anchor) === identityOf(focus) && anchor.colKey === focus.colKey)) {
    return [clientOperationsPresentationCellKey(focus)];
  }
  const sameKind =
    Boolean(anchor.rowKey) === Boolean(focus.rowKey) &&
    Boolean(anchor.clientId) === Boolean(focus.clientId);
  if (!sameKind) {
    return [
      ...new Set([
        clientOperationsPresentationCellKey(anchor),
        clientOperationsPresentationCellKey(focus),
      ]),
    ];
  }
  const rowA = identityOf(anchor);
  const rowB = identityOf(focus);
  const rowStart = input.rowIds.indexOf(rowA);
  const rowEnd = input.rowIds.indexOf(rowB);
  const colStart = input.columnKeys.indexOf(anchor.colKey);
  const colEnd = input.columnKeys.indexOf(focus.colKey);
  if (rowStart < 0 || rowEnd < 0 || colStart < 0 || colEnd < 0) {
    return [clientOperationsPresentationCellKey(focus)];
  }
  const r0 = Math.min(rowStart, rowEnd);
  const r1 = Math.max(rowStart, rowEnd);
  const c0 = Math.min(colStart, colEnd);
  const c1 = Math.max(colStart, colEnd);
  const keys: string[] = [];
  for (let r = r0; r <= r1; r += 1) {
    const rowId = input.rowIds[r];
    if (!rowId) continue;
    for (let c = c0; c <= c1; c += 1) {
      const colKey = input.columnKeys[c];
      if (!colKey) continue;
      const cell: ClientOperationsActiveCell = focus.rowKey
        ? { rowKey: rowId, colKey }
        : { clientId: rowId, colKey };
      keys.push(clientOperationsPresentationCellKey(cell));
    }
  }
  return keys;
}

export function isClientOperationsFormatRangeCell(input: {
  keys: readonly string[];
  cell: ClientOperationsActiveCell;
}): boolean {
  return input.keys.includes(clientOperationsPresentationCellKey(input.cell));
}
