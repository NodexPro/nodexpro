/**
 * Client Operations — personal decorative cell formatting (pure).
 * Not business status, Accounting Base, or statutory truth.
 * Identity: organization + user + period + stable row + stable column.
 */

export const CLIENT_OPERATIONS_CELL_PRESENTATION_COMMAND =
  'set_client_operations_cell_presentation';

export const CLIENT_OPERATIONS_CELL_PRESENTATION_BULK_MAX = 2000;

export const CLIENT_OPERATIONS_CELL_PRESENTATION_FONT_SIZES = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32,
] as const;

export const CLIENT_OPERATIONS_MANUAL_ROW_ID_RE = /^manual:0[1-5]$/;
export const CLIENT_OPERATIONS_PERIOD_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const ALIGNMENTS = new Set(['right', 'center', 'left']);
const NUMBER_FORMATS = new Set(['general', 'number', 'currency', 'percent', 'date']);

export type ClientOperationsCellPresentationRowKind = 'client' | 'manual';

export type ClientOperationsCellPresentation = {
  align?: 'right' | 'center' | 'left';
  wrap?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  fill?: string;
  fontSize?: number;
  numberFormat?: 'general' | 'number' | 'currency' | 'percent' | 'date';
};

export type ClientOperationsCellPresentationWrite = {
  row_kind: ClientOperationsCellPresentationRowKind;
  row_id: string;
  column_key: string;
  presentation: ClientOperationsCellPresentation | null;
};

export function isClientOperationsCellPresentationPeriodKey(value: unknown): value is string {
  return typeof value === 'string' && CLIENT_OPERATIONS_PERIOD_KEY_RE.test(value);
}

export function isClientOperationsPresentationUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function isClientOperationsManualPresentationRowId(value: string): boolean {
  return CLIENT_OPERATIONS_MANUAL_ROW_ID_RE.test(value);
}

export function clientOperationsPresentationMapKey(rowId: string, columnKey: string): string {
  return `${rowId}::${columnKey}`;
}

export function parseClientOperationsPresentationMapKey(
  key: string,
): { identity: string; columnKey: string } | null {
  const raw = String(key ?? '');
  const sep = raw.lastIndexOf('::');
  if (sep <= 0 || sep === raw.length - 2) return null;
  const identity = raw.slice(0, sep).trim();
  const columnKey = raw.slice(sep + 2).trim();
  if (!identity || !columnKey) return null;
  return { identity, columnKey };
}

export function resolveClientOperationsPresentationRowIdentity(identity: string): {
  row_kind: ClientOperationsCellPresentationRowKind;
  row_id: string;
} | null {
  const rowId = String(identity ?? '').trim();
  if (!rowId) return null;
  if (isClientOperationsManualPresentationRowId(rowId)) {
    return { row_kind: 'manual', row_id: rowId };
  }
  if (isClientOperationsPresentationUuid(rowId)) {
    return { row_kind: 'client', row_id: rowId.toLowerCase() };
  }
  return null;
}

export function clientOperationsCellPresentationStorageIdentity(input: {
  organizationId: string;
  userId: string;
  operationalPeriodKey: string;
  rowKind: ClientOperationsCellPresentationRowKind;
  rowId: string;
  columnKey: string;
}): string {
  return [
    input.organizationId,
    input.userId,
    input.operationalPeriodKey,
    input.rowKind,
    input.rowId,
    input.columnKey,
  ].join('\u001f');
}

export function sanitizeClientOperationsCellPresentation(
  value: unknown,
): ClientOperationsCellPresentation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const out: ClientOperationsCellPresentation = {};
  if (typeof raw.align === 'string' && ALIGNMENTS.has(raw.align)) {
    out.align = raw.align as ClientOperationsCellPresentation['align'];
  }
  if (typeof raw.wrap === 'boolean') out.wrap = raw.wrap;
  if (typeof raw.bold === 'boolean') out.bold = raw.bold;
  if (typeof raw.italic === 'boolean') out.italic = raw.italic;
  if (typeof raw.underline === 'boolean') out.underline = raw.underline;
  if (typeof raw.color === 'string' && HEX_COLOR_RE.test(raw.color.trim())) {
    out.color = raw.color.trim().toLowerCase();
  }
  if (typeof raw.fill === 'string' && HEX_COLOR_RE.test(raw.fill.trim())) {
    out.fill = raw.fill.trim().toLowerCase();
  }
  if (typeof raw.fontSize === 'number' && Number.isFinite(raw.fontSize)) {
    const size = Math.round(raw.fontSize);
    if ((CLIENT_OPERATIONS_CELL_PRESENTATION_FONT_SIZES as readonly number[]).includes(size)) {
      out.fontSize = size;
    }
  }
  if (typeof raw.numberFormat === 'string' && NUMBER_FORMATS.has(raw.numberFormat)) {
    out.numberFormat = raw.numberFormat as ClientOperationsCellPresentation['numberFormat'];
  }
  return Object.keys(out).length ? out : null;
}

export function presentationsEqual(
  left: ClientOperationsCellPresentation | null,
  right: ClientOperationsCellPresentation | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

export function parseClientOperationsCellPresentationWrites(
  raw: unknown,
): ClientOperationsCellPresentationWrite[] {
  if (!Array.isArray(raw)) {
    throw new Error('cells must be an array');
  }
  if (raw.length < 1 || raw.length > CLIENT_OPERATIONS_CELL_PRESENTATION_BULK_MAX) {
    throw new Error('cells bulk size invalid');
  }
  const collapsed = new Map<string, ClientOperationsCellPresentationWrite>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('each cell write must be an object');
    }
    const rec = item as Record<string, unknown>;
    const rowKindRaw = String(rec.row_kind ?? '').trim();
    const rowId = String(rec.row_id ?? '').trim();
    const columnKey = String(rec.column_key ?? '').trim();
    if (rowKindRaw !== 'client' && rowKindRaw !== 'manual') {
      throw new Error('row_kind must be client or manual');
    }
    if (!rowId || !columnKey) {
      throw new Error('row_id and column_key are required');
    }
    if (columnKey === 'folder') {
      throw new Error('folder column cannot receive decorative formatting');
    }
    if (rowKindRaw === 'client' && !isClientOperationsPresentationUuid(rowId)) {
      throw new Error('client row_id must be a stable client uuid');
    }
    if (rowKindRaw === 'manual' && !isClientOperationsManualPresentationRowId(rowId)) {
      throw new Error('manual row_id must be a stable manual:01..05 key');
    }
    const presentation =
      rec.presentation === null || rec.presentation === undefined
        ? null
        : sanitizeClientOperationsCellPresentation(rec.presentation);
    const write: ClientOperationsCellPresentationWrite = {
      row_kind: rowKindRaw,
      row_id: rowKindRaw === 'client' ? rowId.toLowerCase() : rowId,
      column_key: columnKey,
      presentation,
    };
    collapsed.set(`${write.row_kind}\u001f${write.row_id}\u001f${write.column_key}`, write);
  }
  return [...collapsed.values()];
}

export function toClientOperationsUserCellFormattingMap(
  rows: Array<{
    row_kind: string;
    row_id: string;
    column_key: string;
    presentation: unknown;
  }>,
): Record<string, ClientOperationsCellPresentation> {
  const out: Record<string, ClientOperationsCellPresentation> = {};
  for (const row of rows) {
    const rowId = String(row.row_id ?? '').trim();
    const columnKey = String(row.column_key ?? '').trim();
    if (!rowId || !columnKey || columnKey === 'folder') continue;
    if (row.row_kind === 'client' && !isClientOperationsPresentationUuid(rowId)) continue;
    if (row.row_kind === 'manual' && !isClientOperationsManualPresentationRowId(rowId)) continue;
    if (row.row_kind !== 'client' && row.row_kind !== 'manual') continue;
    const presentation = sanitizeClientOperationsCellPresentation(row.presentation);
    if (!presentation) continue;
    out[clientOperationsPresentationMapKey(rowId, columnKey)] = presentation;
  }
  return out;
}
