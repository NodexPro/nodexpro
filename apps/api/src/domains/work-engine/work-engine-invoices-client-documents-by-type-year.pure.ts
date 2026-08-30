/**
 * P4.2 — deterministic selected-year date bounds for documents-by-type DB filters.
 * Preserves existing Node semantics:
 * - issued: calendar year of issue_date
 * - drafts: calendar year of (updated_at || created_at) via ISO date prefix
 */

export type DocumentsByTypeYearBounds = {
  /** Inclusive lower bound YYYY-01-01 */
  startInclusive: string;
  /** Exclusive upper bound (year+1)-01-01 */
  endExclusive: string;
};

/** Translate selectedYear → half-open [start, end) calendar bounds. */
export function documentsByTypeSelectedYearBounds(year: number): DocumentsByTypeYearBounds {
  const y = Math.trunc(year);
  return {
    startInclusive: `${y}-01-01`,
    endExclusive: `${y + 1}-01-01`,
  };
}

/** Match issued Node year: issueYearFromIso(issue_date) === year */
export function isIssueDateInSelectedYear(
  issueDate: string | null | undefined,
  year: number,
): boolean {
  if (!issueDate) return false;
  const iso = String(issueDate).trim();
  if (iso.length < 4) return false;
  const y = Number.parseInt(iso.slice(0, 4), 10);
  if (!Number.isFinite(y)) return false;
  return y === year;
}

/**
 * Match draft Node year: yearFromTimestamp(updated_at || created_at)
 * using ISO date-prefix calendar year.
 */
export function isDraftActivityInSelectedYear(
  updatedAt: string | null | undefined,
  createdAt: string | null | undefined,
  year: number,
): boolean {
  const activityAt = updatedAt || createdAt;
  if (!activityAt) return false;
  const iso = String(activityAt);
  const datePart = iso.length >= 10 ? iso.slice(0, 10) : iso;
  return isIssueDateInSelectedYear(datePart, year);
}
