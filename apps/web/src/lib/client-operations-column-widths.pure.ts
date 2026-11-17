/**
 * Client Operations column widths.
 * System column widths are personal backend prefs. Custom `width_px` stays org-owned.
 * localStorage helpers are retained unused as the write path until a confirmed cutover.
 */

export const CLIENT_OPERATIONS_COLUMN_WIDTHS_STORAGE_PREFIX = 'nx.client-operations.column-widths.v1';
export const CLIENT_OPERATIONS_USER_SYSTEM_COLUMN_WIDTH_COMMAND =
  'set_client_operations_user_system_column_width';
export const CLIENT_OPERATIONS_COLUMN_WIDTH_MIN = 48;
export const CLIENT_OPERATIONS_COLUMN_WIDTH_MAX = 480;
export const CLIENT_OPERATIONS_CUSTOM_COLUMN_WIDTH_MIN = 96;
export const CLIENT_OPERATIONS_CUSTOM_COLUMN_WIDTH_DEFAULT = 160;
export const CLIENT_OPERATIONS_CUSTOM_COLUMN_WIDTH_MAX = 480;

export function clientOperationsColumnWidthsStorageKey(userId: string, organizationId: string): string {
  return `${CLIENT_OPERATIONS_COLUMN_WIDTHS_STORAGE_PREFIX}:${userId}:${organizationId}`;
}

export function clampClientOperationsColumnWidth(width: number): number {
  if (!Number.isFinite(width)) return CLIENT_OPERATIONS_COLUMN_WIDTH_MIN;
  return Math.min(CLIENT_OPERATIONS_COLUMN_WIDTH_MAX, Math.max(CLIENT_OPERATIONS_COLUMN_WIDTH_MIN, Math.round(width)));
}

export function clampClientOperationsCustomColumnWidth(width: number): number {
  if (!Number.isFinite(width)) return CLIENT_OPERATIONS_CUSTOM_COLUMN_WIDTH_DEFAULT;
  return Math.min(
    CLIENT_OPERATIONS_CUSTOM_COLUMN_WIDTH_MAX,
    Math.max(CLIENT_OPERATIONS_CUSTOM_COLUMN_WIDTH_MIN, Math.round(width)),
  );
}

export function omitClientOperationsCustomColumnKeys(
  widths: Record<string, number>,
  customKeys: Iterable<string>,
): Record<string, number> {
  const skip = new Set(customKeys);
  if (skip.size === 0) return widths;
  return Object.fromEntries(Object.entries(widths).filter(([key]) => !skip.has(key)));
}

export function loadClientOperationsColumnWidths(
  userId: string,
  organizationId: string,
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): Record<string, number> {
  if (!storage || !userId || !organizationId) return {};
  try {
    const raw = storage.getItem(clientOperationsColumnWidthsStorageKey(userId, organizationId));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) =>
        typeof value === 'number' && Number.isFinite(value) ? [[key, clampClientOperationsColumnWidth(value)]] : [],
      ),
    );
  } catch {
    return {};
  }
}

export function saveClientOperationsColumnWidths(
  userId: string,
  organizationId: string,
  widths: Record<string, number>,
  storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): void {
  if (!storage || !userId || !organizationId) return;
  const clean = Object.fromEntries(
    Object.entries(widths)
      .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
      .map(([key, value]) => [key, clampClientOperationsColumnWidth(value)]),
  );
  try {
    storage.setItem(clientOperationsColumnWidthsStorageKey(userId, organizationId), JSON.stringify(clean));
  } catch {
    // Preferences are non-critical and may be unavailable in private browsing.
  }
}
