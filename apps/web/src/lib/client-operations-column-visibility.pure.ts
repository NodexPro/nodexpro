/**
 * Presentation column hide/show helpers (does not delete registry data).
 */

export const CLIENT_OPERATIONS_MANDATORY_VISIBLE_COLUMN_KEYS = ['folder', 'client_name'] as const;

export function isClientOperationsMandatoryVisibleColumn(key: string): boolean {
  return (CLIENT_OPERATIONS_MANDATORY_VISIBLE_COLUMN_KEYS as readonly string[]).includes(key);
}

export function toggleClientOperationsHiddenColumn(
  hidden: ReadonlySet<string>,
  columnKey: string,
): Set<string> {
  const next = new Set(hidden);
  if (isClientOperationsMandatoryVisibleColumn(columnKey)) return next;
  if (next.has(columnKey)) next.delete(columnKey);
  else next.add(columnKey);
  return next;
}
