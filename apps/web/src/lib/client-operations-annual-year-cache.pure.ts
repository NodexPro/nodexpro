/**
 * Presentation cache for annual-tab year snapshots.
 * Not business truth: keys are org + client + tax year + aggregate version.
 */

export type AnnualYearSnapshotKeyInput = {
  organizationId: string | null | undefined;
  clientId: string | null | undefined;
  taxYear: number;
  aggregateVersion: number;
};

export function buildAnnualYearSnapshotKey(input: AnnualYearSnapshotKeyInput): string {
  const org = String(input.organizationId ?? '').trim();
  const client = String(input.clientId ?? '').trim();
  const year = Number(input.taxYear);
  const version = Number(input.aggregateVersion);
  if (!org || !client || !Number.isInteger(year) || !Number.isFinite(version)) return '';
  return `${org}\u001f${client}\u001f${year}\u001f${version}`;
}

export function putAnnualYearSnapshot<T>(
  cache: Map<string, T>,
  input: AnnualYearSnapshotKeyInput,
  snapshot: T,
): void {
  const key = buildAnnualYearSnapshotKey(input);
  if (!key) return;
  cache.set(key, snapshot);
}

export function getAnnualYearSnapshot<T>(
  cache: Map<string, T>,
  input: AnnualYearSnapshotKeyInput,
): T | null {
  const key = buildAnnualYearSnapshotKey(input);
  if (!key) return null;
  return cache.get(key) ?? null;
}

export function invalidateAnnualYearSnapshotsForClient(
  cache: Map<string, unknown>,
  input: { organizationId: string | null | undefined; clientId: string | null | undefined },
): void {
  const org = String(input.organizationId ?? '').trim();
  const client = String(input.clientId ?? '').trim();
  if (!org || !client) return;
  const prefix = `${org}\u001f${client}\u001f`;
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** Keep the user's selected tab; a late command must not move the tab to another year. */
export function resolveDisplayedAnnualTaxYear(input: {
  selectedYear: number | null | undefined;
  workingTaxYear: number | null | undefined;
  boardYears: readonly number[];
  extraYears?: readonly number[];
}): number | null {
  const board = input.boardYears.filter((year) => Number.isInteger(year));
  const extra = (input.extraYears ?? []).filter((year) => Number.isInteger(year) && !board.includes(year));
  const allowed = [...board, ...extra];
  if (allowed.includes(input.selectedYear as number)) return input.selectedYear as number;
  if (allowed.includes(input.workingTaxYear as number)) return input.workingTaxYear as number;
  return board[0] ?? extra[0] ?? null;
}

export function shouldApplyAnnualYearPersistResponse(input: {
  selectedYear?: number | null | undefined;
  persistedYear?: number | null | undefined;
  pendingYear?: number | null;
  persistGeneration: number;
  responseGeneration: number;
}): boolean {
  if (input.persistGeneration !== input.responseGeneration) return false;
  return true;
}

export function annualTabVersionFromCase(caseBody: {
  annual_tab?: { read_model_version?: number } | null;
  capital_declaration_tab?: { read_model_version?: number } | null;
} | null | undefined): number | null {
  const version =
    caseBody?.annual_tab?.read_model_version ?? caseBody?.capital_declaration_tab?.read_model_version;
  return typeof version === 'number' && Number.isFinite(version) ? version : null;
}
