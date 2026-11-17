/**
 * Client Operations — personal sheet layout (hidden columns + system widths).
 * Not period-scoped. Not org-owned custom column visible / width_px.
 */

export const CLIENT_OPERATIONS_USER_HIDDEN_COLUMNS_COMMAND =
  'set_client_operations_user_hidden_columns';
export const CLIENT_OPERATIONS_USER_SYSTEM_COLUMN_WIDTH_COMMAND =
  'set_client_operations_user_system_column_width';

export const CLIENT_OPERATIONS_USER_HIDDEN_COLUMNS_MAX = 40;
export const CLIENT_OPERATIONS_SYSTEM_COLUMN_WIDTH_MIN = 48;
export const CLIENT_OPERATIONS_SYSTEM_COLUMN_WIDTH_MAX = 480;

export const CLIENT_OPERATIONS_MANDATORY_VISIBLE_COLUMN_KEYS = ['folder', 'client_name'] as const;

export function isClientOperationsMandatoryVisibleColumn(key: string): boolean {
  return (CLIENT_OPERATIONS_MANDATORY_VISIBLE_COLUMN_KEYS as readonly string[]).includes(key);
}

export function clampClientOperationsSystemColumnWidth(width: unknown): number {
  const n = typeof width === 'number' ? width : typeof width === 'string' ? Number(width) : NaN;
  if (!Number.isFinite(n)) return CLIENT_OPERATIONS_SYSTEM_COLUMN_WIDTH_MIN;
  return Math.min(
    CLIENT_OPERATIONS_SYSTEM_COLUMN_WIDTH_MAX,
    Math.max(CLIENT_OPERATIONS_SYSTEM_COLUMN_WIDTH_MIN, Math.round(n)),
  );
}

export function sanitizeClientOperationsHiddenColumnKeys(
  keys: unknown,
  eligibleColumnKeys: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(keys)) {
    throw new Error('column_keys must be an array');
  }
  if (keys.length > CLIENT_OPERATIONS_USER_HIDDEN_COLUMNS_MAX) {
    throw new Error('column_keys bulk size invalid');
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of keys) {
    const key = String(raw ?? '').trim();
    if (!key || key.length > 80) continue;
    if (isClientOperationsMandatoryVisibleColumn(key)) continue;
    if (!eligibleColumnKeys.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function sanitizeClientOperationsSystemColumnWidths(
  raw: unknown,
  systemColumnKeys: ReadonlySet<string>,
): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const columnKey = String(key ?? '').trim();
    if (!columnKey || !systemColumnKeys.has(columnKey)) continue;
    if (typeof value !== 'number' && typeof value !== 'string') continue;
    out[columnKey] = clampClientOperationsSystemColumnWidth(value);
  }
  return out;
}

export function parseClientOperationsSystemColumnWidthWrite(input: {
  columnKey: unknown;
  widthPx: unknown;
  systemColumnKeys: ReadonlySet<string>;
}): { column_key: string; width_px: number } {
  const columnKey = String(input.columnKey ?? '').trim();
  if (!columnKey) throw new Error('column_key is required');
  if (!input.systemColumnKeys.has(columnKey)) {
    throw new Error('column_key is not a system registry column');
  }
  if (input.widthPx === null || input.widthPx === undefined || input.widthPx === '') {
    throw new Error('width_px is required');
  }
  const n = typeof input.widthPx === 'number' ? input.widthPx : Number(input.widthPx);
  if (!Number.isFinite(n)) throw new Error('width_px must be a finite number');
  return {
    column_key: columnKey,
    width_px: clampClientOperationsSystemColumnWidth(n),
  };
}

export function userSheetLayoutStorageIdentity(input: {
  organizationId: string;
  userId: string;
}): string {
  return `${input.organizationId}\u001f${input.userId}`;
}
