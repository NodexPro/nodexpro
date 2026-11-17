/**
 * Client Operations cell presentation.
 * Production hydrate/save is backend-owned (`user_cell_formatting` + named bulk command).
 * localStorage helpers are retained so existing browser data is not deleted until a
 * confirmed cutover; they are not the write path.
 */

export const CLIENT_OPERATIONS_CELL_PRESENTATION_STORAGE_PREFIX =
  'nx.client-operations.cell-presentation.v1';

export const CLIENT_OPERATIONS_CELL_PRESENTATION_COMMAND =
  'set_client_operations_cell_presentation';

export const CLIENT_OPERATIONS_CELL_PRESENTATION_BULK_MAX = 2000;

export const CLIENT_OPERATIONS_CELL_PRESENTATION_FONT_SIZES = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32,
] as const;

const ALIGNMENTS = new Set(['right', 'center', 'left']);
const NUMBER_FORMATS = new Set(['general', 'number', 'currency', 'percent', 'date']);
const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MANUAL_ROW_RE = /^manual:0[1-5]$/;

export type ClientOperationsStoredCellPresentation = {
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

export type ClientOperationsCellPresentationCommandCell = {
  row_kind: 'client' | 'manual';
  row_id: string;
  column_key: string;
  presentation: ClientOperationsStoredCellPresentation | null;
};

export function clientOperationsCellPresentationStorageKey(
  userId: string,
  organizationId: string,
): string {
  return `${CLIENT_OPERATIONS_CELL_PRESENTATION_STORAGE_PREFIX}:${userId}:${organizationId}`;
}

export function sanitizeClientOperationsCellPresentation(
  value: unknown,
): ClientOperationsStoredCellPresentation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const out: ClientOperationsStoredCellPresentation = {};
  if (typeof raw.align === 'string' && ALIGNMENTS.has(raw.align)) {
    out.align = raw.align as ClientOperationsStoredCellPresentation['align'];
  }
  if (typeof raw.wrap === 'boolean') out.wrap = raw.wrap;
  if (typeof raw.bold === 'boolean') out.bold = raw.bold;
  if (typeof raw.italic === 'boolean') out.italic = raw.italic;
  if (typeof raw.underline === 'boolean') out.underline = raw.underline;
  if (typeof raw.color === 'string' && raw.color.trim()) {
    const color = raw.color.trim();
    out.color = HEX_COLOR_RE.test(color) ? color.toLowerCase() : color;
  }
  if (typeof raw.fill === 'string' && raw.fill.trim()) {
    const fill = raw.fill.trim();
    out.fill = HEX_COLOR_RE.test(fill) ? fill.toLowerCase() : fill;
  }
  if (typeof raw.fontSize === 'number' && Number.isFinite(raw.fontSize)) {
    out.fontSize = Math.round(raw.fontSize);
  }
  if (typeof raw.numberFormat === 'string' && NUMBER_FORMATS.has(raw.numberFormat)) {
    out.numberFormat = raw.numberFormat as ClientOperationsStoredCellPresentation['numberFormat'];
  }
  return Object.keys(out).length ? out : null;
}

function sanitizePresentation(value: unknown): ClientOperationsStoredCellPresentation | null {
  return sanitizeClientOperationsCellPresentation(value);
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
  row_kind: 'client' | 'manual';
  row_id: string;
} | null {
  const rowId = String(identity ?? '').trim();
  if (!rowId) return null;
  if (MANUAL_ROW_RE.test(rowId)) return { row_kind: 'manual', row_id: rowId };
  if (UUID_RE.test(rowId)) return { row_kind: 'client', row_id: rowId.toLowerCase() };
  return null;
}

export function hydrateClientOperationsUserCellFormatting(
  raw: unknown,
): Record<string, ClientOperationsStoredCellPresentation> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).flatMap(([key, value]) => {
      if (!key || typeof key !== 'string') return [];
      const parsed = parseClientOperationsPresentationMapKey(key);
      if (!parsed) return [];
      if (!resolveClientOperationsPresentationRowIdentity(parsed.identity)) return [];
      const clean = sanitizePresentation(value);
      return clean ? [[key, clean]] : [];
    }),
  );
}

function presentationEqual(
  left: ClientOperationsStoredCellPresentation | null,
  right: ClientOperationsStoredCellPresentation | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

export function buildClientOperationsCellPresentationCommandCells(input: {
  previous: Record<string, ClientOperationsStoredCellPresentation>;
  next: Record<string, ClientOperationsStoredCellPresentation>;
}): ClientOperationsCellPresentationCommandCell[] {
  const keys = new Set([...Object.keys(input.previous), ...Object.keys(input.next)]);
  const cells: ClientOperationsCellPresentationCommandCell[] = [];
  for (const key of keys) {
    const parsed = parseClientOperationsPresentationMapKey(key);
    if (!parsed) continue;
    const identity = resolveClientOperationsPresentationRowIdentity(parsed.identity);
    if (!identity) continue;
    if (parsed.columnKey === 'folder') continue;
    const previous = sanitizePresentation(input.previous[key]);
    const next = sanitizePresentation(input.next[key]);
    if (presentationEqual(previous, next)) continue;
    cells.push({
      row_kind: identity.row_kind,
      row_id: identity.row_id,
      column_key: parsed.columnKey,
      presentation: next,
    });
  }
  if (cells.length > CLIENT_OPERATIONS_CELL_PRESENTATION_BULK_MAX) {
    return cells.slice(0, CLIENT_OPERATIONS_CELL_PRESENTATION_BULK_MAX);
  }
  return cells;
}

export function loadClientOperationsCellPresentation(
  userId: string,
  organizationId: string,
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): Record<string, ClientOperationsStoredCellPresentation> {
  if (!storage || !userId || !organizationId) return {};
  try {
    const raw = storage.getItem(clientOperationsCellPresentationStorageKey(userId, organizationId));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(([key, value]) => {
        if (!key || typeof key !== 'string') return [];
        const clean = sanitizePresentation(value);
        return clean ? [[key, clean]] : [];
      }),
    );
  } catch {
    return {};
  }
}

export function saveClientOperationsCellPresentation(
  userId: string,
  organizationId: string,
  presentation: Record<string, ClientOperationsStoredCellPresentation>,
  storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): void {
  if (!storage || !userId || !organizationId) return;
  const clean = Object.fromEntries(
    Object.entries(presentation).flatMap(([key, value]) => {
      const next = sanitizePresentation(value);
      return next ? [[key, next]] : [];
    }),
  );
  try {
    storage.setItem(
      clientOperationsCellPresentationStorageKey(userId, organizationId),
      JSON.stringify(clean),
    );
  } catch {
    // Preferences are non-critical and may be unavailable in private browsing.
  }
}
