/**
 * Presentation-only format selection (single cell, rectangle, disjoint ranges).
 * Decorative fill must not cover system obligation colours.
 * Selection is UI state only — never a backend command / aggregate field.
 */

import type { ClientOperationsActiveCell } from './client-operations-active-cell.pure.js';
import {
  clientOperationsPresentationCellKey,
  isClientOperationsFormatEligibleColumn,
} from './client-operations-active-cell.pure.js';

export type ClientOperationsFormatRange = {
  anchor: ClientOperationsActiveCell;
  focus: ClientOperationsActiveCell;
};

export type ClientOperationsSelectionGesture = 'replace' | 'extend' | 'add';

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

function cellFromRowId(rowId: string, colKey: string): ClientOperationsActiveCell {
  if (rowId.startsWith('manual:')) return { rowKey: rowId, colKey };
  return { clientId: rowId, colKey };
}

export function clientOperationsSelectionGesture(input: {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): ClientOperationsSelectionGesture {
  if (input.ctrlKey || input.metaKey) return 'add';
  if (input.shiftKey) return 'extend';
  return 'replace';
}

export function formatSelectionKeysForRange(input: {
  range: ClientOperationsFormatRange;
  rowIds: readonly string[];
  columnKeys: readonly string[];
}): string[] {
  const { anchor, focus } = input.range;
  if (identityOf(anchor) === identityOf(focus) && anchor.colKey === focus.colKey) {
    return [clientOperationsPresentationCellKey(focus)];
  }
  const rowA = identityOf(anchor);
  const rowB = identityOf(focus);
  const rowStart = input.rowIds.indexOf(rowA);
  const rowEnd = input.rowIds.indexOf(rowB);
  const colStart = input.columnKeys.indexOf(anchor.colKey);
  const colEnd = input.columnKeys.indexOf(focus.colKey);
  if (rowStart < 0 || rowEnd < 0 || colStart < 0 || colEnd < 0) {
    return [
      ...new Set([
        clientOperationsPresentationCellKey(anchor),
        clientOperationsPresentationCellKey(focus),
      ]),
    ];
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
      if (!isClientOperationsFormatEligibleColumn({ columnKey: colKey })) continue;
      keys.push(clientOperationsPresentationCellKey(cellFromRowId(rowId, colKey)));
    }
  }
  return keys;
}

export function listClientOperationsFormatSelectionKeys(input: {
  range: ClientOperationsFormatRange | null;
  ranges?: readonly ClientOperationsFormatRange[] | null;
  focused: ClientOperationsActiveCell | null;
  rowIds: readonly string[];
  columnKeys: readonly string[];
}): string[] {
  const ranges =
    input.ranges && input.ranges.length
      ? input.ranges
      : input.range
        ? [input.range]
        : [];
  if (ranges.length) {
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const range of ranges) {
      for (const key of formatSelectionKeysForRange({
        range,
        rowIds: input.rowIds,
        columnKeys: input.columnKeys,
      })) {
        if (seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
      }
    }
    return keys;
  }
  if (!input.focused) return [];
  return [clientOperationsPresentationCellKey(input.focused)];
}

export function listClientOperationsTableSelectionKeys(input: {
  clientIds: readonly string[];
  manualRowKeys: readonly string[];
  columnKeys: readonly string[];
}): string[] {
  const keys: string[] = [];
  const eligible = input.columnKeys.filter((columnKey) =>
    isClientOperationsFormatEligibleColumn({ columnKey }),
  );
  for (const clientId of input.clientIds) {
    for (const colKey of eligible) {
      keys.push(clientOperationsPresentationCellKey({ clientId, colKey }));
    }
  }
  for (const rowKey of input.manualRowKeys) {
    for (const colKey of eligible) {
      keys.push(clientOperationsPresentationCellKey({ rowKey, colKey }));
    }
  }
  return keys;
}

export function tableSelectionRange(input: {
  clientIds: readonly string[];
  manualRowKeys: readonly string[];
  columnKeys: readonly string[];
}): ClientOperationsFormatRange | null {
  const rowIds = [...input.clientIds, ...input.manualRowKeys];
  const eligible = input.columnKeys.filter((columnKey) =>
    isClientOperationsFormatEligibleColumn({ columnKey }),
  );
  const firstRow = rowIds[0];
  const lastRow = rowIds[rowIds.length - 1];
  const firstCol = eligible[0];
  const lastCol = eligible[eligible.length - 1];
  if (!firstRow || !lastRow || !firstCol || !lastCol) return null;
  return {
    anchor: cellFromRowId(firstRow, firstCol),
    focus: cellFromRowId(lastRow, lastCol),
  };
}

export function isClientOperationsFormatRangeCell(input: {
  keys: readonly string[];
  cell: ClientOperationsActiveCell;
}): boolean {
  return input.keys.includes(clientOperationsPresentationCellKey(input.cell));
}

export type ClientOperationsSelectionFrameEdges = {
  blockStart: boolean;
  blockEnd: boolean;
  inlineStart: boolean;
  inlineEnd: boolean;
};

export function clientOperationsSelectionFrameEdges(input: {
  keys: readonly string[];
  cell: ClientOperationsActiveCell;
  rowIds: readonly string[];
  columnKeys: readonly string[];
}): ClientOperationsSelectionFrameEdges | null {
  const key = clientOperationsPresentationCellKey(input.cell);
  if (!input.keys.includes(key)) return null;
  const rowId = identityOf(input.cell);
  const rowIndex = input.rowIds.indexOf(rowId);
  const colIndex = input.columnKeys.indexOf(input.cell.colKey);
  if (rowIndex < 0 || colIndex < 0) {
    return { blockStart: true, blockEnd: true, inlineStart: true, inlineEnd: true };
  }
  const neighborSelected = (r: number, c: number): boolean => {
    const neighborRow = input.rowIds[r];
    const neighborCol = input.columnKeys[c];
    if (!neighborRow || !neighborCol) return false;
    if (!isClientOperationsFormatEligibleColumn({ columnKey: neighborCol })) return false;
    return input.keys.includes(
      clientOperationsPresentationCellKey(cellFromRowId(neighborRow, neighborCol)),
    );
  };
  return {
    blockStart: !neighborSelected(rowIndex - 1, colIndex),
    blockEnd: !neighborSelected(rowIndex + 1, colIndex),
    inlineStart: !neighborSelected(rowIndex, colIndex - 1),
    inlineEnd: !neighborSelected(rowIndex, colIndex + 1),
  };
}

export function clientOperationsSelectionFrameClass(
  edges: ClientOperationsSelectionFrameEdges | null,
): string {
  if (!edges) return '';
  return [
    edges.blockStart ? 'is-sel-edge-block-start' : '',
    edges.blockEnd ? 'is-sel-edge-block-end' : '',
    edges.inlineStart ? 'is-sel-edge-inline-start' : '',
    edges.inlineEnd ? 'is-sel-edge-inline-end' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Drag that moved, or a modifier gesture, must not fire the leftover click. */
export function shouldSuppressFormatSelectionClick(input: {
  dragMoved: boolean;
  gesture: ClientOperationsSelectionGesture;
}): boolean {
  return input.dragMoved || input.gesture !== 'replace';
}

export function formatDragExceededThreshold(input: {
  startX: number;
  startY: number;
  x: number;
  y: number;
  thresholdPx?: number;
}): boolean {
  const threshold = input.thresholdPx ?? 3;
  return (
    Math.abs(input.x - input.startX) >= threshold || Math.abs(input.y - input.startY) >= threshold
  );
}

export function applyFormatSelectionGesture(input: {
  gesture: ClientOperationsSelectionGesture;
  next: ClientOperationsActiveCell;
  ranges: readonly ClientOperationsFormatRange[];
  focused: ClientOperationsActiveCell | null;
}): ClientOperationsFormatRange[] {
  if (input.gesture === 'extend') {
    const current = input.ranges[input.ranges.length - 1];
    const anchor = current?.anchor ?? input.focused ?? input.next;
    return [...input.ranges.slice(0, -1), { anchor, focus: input.next }];
  }
  if (input.gesture === 'add') {
    return [...input.ranges, { anchor: input.next, focus: input.next }];
  }
  return [{ anchor: input.next, focus: input.next }];
}
