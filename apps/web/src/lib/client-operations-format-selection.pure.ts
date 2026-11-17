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

export function sameFormatSelectionCell(
  left: ClientOperationsActiveCell | null | undefined,
  right: ClientOperationsActiveCell | null | undefined,
): boolean {
  if (!left || !right) return false;
  return identityOf(left) === identityOf(right) && left.colKey === right.colKey;
}

export function splitFormatRangeExcludingCell(input: {
  range: ClientOperationsFormatRange;
  cell: ClientOperationsActiveCell;
  rowIds: readonly string[];
  columnKeys: readonly string[];
}): ClientOperationsFormatRange[] {
  const keys = formatSelectionKeysForRange({
    range: input.range,
    rowIds: input.rowIds,
    columnKeys: input.columnKeys,
  });
  const excluded = clientOperationsPresentationCellKey(input.cell);
  if (!keys.includes(excluded)) return [input.range];
  if (keys.length === 1) return [];
  const rowA = input.rowIds.indexOf(identityOf(input.range.anchor));
  const rowB = input.rowIds.indexOf(identityOf(input.range.focus));
  const colA = input.columnKeys.indexOf(input.range.anchor.colKey);
  const colB = input.columnKeys.indexOf(input.range.focus.colKey);
  const hitRow = input.rowIds.indexOf(identityOf(input.cell));
  const hitCol = input.columnKeys.indexOf(input.cell.colKey);
  if (rowA < 0 || rowB < 0 || colA < 0 || colB < 0 || hitRow < 0 || hitCol < 0) {
    return keys
      .filter((key) => key !== excluded)
      .map((key) => {
        const sep = key.lastIndexOf('::');
        return {
          anchor: cellFromRowId(key.slice(0, sep), key.slice(sep + 2)),
          focus: cellFromRowId(key.slice(0, sep), key.slice(sep + 2)),
        };
      });
  }
  const r0 = Math.min(rowA, rowB);
  const r1 = Math.max(rowA, rowB);
  const c0 = Math.min(colA, colB);
  const c1 = Math.max(colA, colB);
  const out: ClientOperationsFormatRange[] = [];
  const pushRect = (rowStart: number, rowEnd: number, colStart: number, colEnd: number) => {
    if (rowStart > rowEnd || colStart > colEnd) return;
    const startRow = input.rowIds[rowStart];
    const endRow = input.rowIds[rowEnd];
    const startCol = input.columnKeys[colStart];
    const endCol = input.columnKeys[colEnd];
    if (!startRow || !endRow || !startCol || !endCol) return;
    out.push({
      anchor: cellFromRowId(startRow, startCol),
      focus: cellFromRowId(endRow, endCol),
    });
  };
  if (hitRow > r0) pushRect(r0, hitRow - 1, c0, c1);
  if (hitRow < r1) pushRect(hitRow + 1, r1, c0, c1);
  if (hitCol > c0) pushRect(hitRow, hitRow, c0, hitCol - 1);
  if (hitCol < c1) pushRect(hitRow, hitRow, hitCol + 1, c1);
  return out;
}

export function toggleCellInFormatSelection(input: {
  cell: ClientOperationsActiveCell;
  ranges: readonly ClientOperationsFormatRange[];
  rowIds: readonly string[];
  columnKeys: readonly string[];
}): ClientOperationsFormatRange[] {
  const selected = listClientOperationsFormatSelectionKeys({
    range: null,
    ranges: input.ranges,
    focused: null,
    rowIds: input.rowIds,
    columnKeys: input.columnKeys,
  });
  const key = clientOperationsPresentationCellKey(input.cell);
  if (!selected.includes(key)) {
    return [...input.ranges, { anchor: input.cell, focus: input.cell }];
  }
  return input.ranges.flatMap((range) =>
    splitFormatRangeExcludingCell({
      range,
      cell: input.cell,
      rowIds: input.rowIds,
      columnKeys: input.columnKeys,
    }),
  );
}

export function scrollDeltaForPointerNearEdge(input: {
  clientX: number;
  clientY: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  edgePx?: number;
  stepPx?: number;
}): { x: number; y: number } {
  const edge = input.edgePx ?? 28;
  const step = input.stepPx ?? 24;
  let x = 0;
  let y = 0;
  if (input.clientX < input.left + edge) x = -step;
  else if (input.clientX > input.right - edge) x = step;
  if (input.clientY < input.top + edge) y = -step;
  else if (input.clientY > input.bottom - edge) y = step;
  return { x, y };
}
