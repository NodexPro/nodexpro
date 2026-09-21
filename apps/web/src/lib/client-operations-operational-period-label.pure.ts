/**
 * Presentation-only helpers for Client Operations operational period keys.
 * Converts YYYY-MM <-> MM.YY display. No applicability / frequency logic.
 */

const PERIOD_KEY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isClientOperationsOperationalPeriodKey(value: string | null | undefined): boolean {
  return typeof value === 'string' && PERIOD_KEY_RE.test(value.trim());
}

/** 2026-09 -> 09.26 (display only). */
export function formatClientOperationsOperationalPeriodTabLabel(
  operationalPeriodKey: string,
): string {
  const match = PERIOD_KEY_RE.exec(operationalPeriodKey.trim());
  if (!match) return operationalPeriodKey;
  const year = match[1]!;
  const month = match[2]!;
  return `${month}.${year.slice(2)}`;
}

/** Build YYYY-MM from month (1-12) + year. Returns null if invalid. */
export function buildClientOperationsOperationalPeriodKey(
  month: number,
  year: number,
): string | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function parseClientOperationsOperationalPeriodKey(operationalPeriodKey: string): {
  year: number;
  month: number;
} | null {
  const match = PERIOD_KEY_RE.exec(operationalPeriodKey.trim());
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}
