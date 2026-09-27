/**
 * Font-size options for Client Operations spreadsheet cells (presentation only).
 */

export const CLIENT_OPERATIONS_FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24] as const;

export type ClientOperationsFontSize = (typeof CLIENT_OPERATIONS_FONT_SIZES)[number];

/** Control default when cell has no explicit fontSize (existing cells stay unchanged). */
export const CLIENT_OPERATIONS_DEFAULT_FONT_SIZE: ClientOperationsFontSize = 12;

export function isClientOperationsFontSize(value: unknown): value is ClientOperationsFontSize {
  return typeof value === 'number' && (CLIENT_OPERATIONS_FONT_SIZES as readonly number[]).includes(value);
}

export function normalizeClientOperationsFontSize(value: unknown): ClientOperationsFontSize {
  if (isClientOperationsFontSize(value)) return value;
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (isClientOperationsFontSize(n)) return n;
  return CLIENT_OPERATIONS_DEFAULT_FONT_SIZE;
}
