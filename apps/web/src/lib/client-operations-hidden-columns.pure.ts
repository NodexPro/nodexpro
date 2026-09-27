/**
 * Client Operations hidden-column preferences (localStorage).
 * Presentation only — does not delete registry columns/data.
 * Scoped by user + organization.
 */

import {
  CLIENT_OPERATIONS_MANDATORY_VISIBLE_COLUMN_KEYS,
  isClientOperationsMandatoryVisibleColumn,
} from './client-operations-column-visibility.pure.js';

export const CLIENT_OPERATIONS_HIDDEN_COLUMNS_STORAGE_PREFIX =
  'nx.client-operations.hidden-columns.v1';

export function clientOperationsHiddenColumnsStorageKey(
  userId: string,
  organizationId: string,
): string {
  return `${CLIENT_OPERATIONS_HIDDEN_COLUMNS_STORAGE_PREFIX}:${userId}:${organizationId}`;
}

/**
 * Drop mandatory identity columns and empty/invalid keys.
 * Unknown column keys may remain — UI ignores them until a matching column exists;
 * new backend columns stay visible unless explicitly present in the set.
 */
export function sanitizeClientOperationsHiddenColumnKeys(
  keys: Iterable<string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of keys) {
    const key = String(raw ?? '').trim();
    if (!key) continue;
    if (isClientOperationsMandatoryVisibleColumn(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function loadClientOperationsHiddenColumns(
  userId: string,
  organizationId: string,
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): Set<string> {
  if (!storage || !userId || !organizationId) return new Set();
  try {
    const raw = storage.getItem(clientOperationsHiddenColumnsStorageKey(userId, organizationId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      sanitizeClientOperationsHiddenColumnKeys(
        parsed.filter((item): item is string => typeof item === 'string'),
      ),
    );
  } catch {
    return new Set();
  }
}

export function saveClientOperationsHiddenColumns(
  userId: string,
  organizationId: string,
  hidden: Iterable<string>,
  storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): void {
  if (!storage || !userId || !organizationId) return;
  const clean = sanitizeClientOperationsHiddenColumnKeys(hidden);
  try {
    storage.setItem(
      clientOperationsHiddenColumnsStorageKey(userId, organizationId),
      JSON.stringify(clean),
    );
  } catch {
    // Preferences are non-critical and may be unavailable in private browsing.
  }
}

export { CLIENT_OPERATIONS_MANDATORY_VISIBLE_COLUMN_KEYS };
