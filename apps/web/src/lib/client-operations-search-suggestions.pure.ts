/**
 * Client Operations search suggestions — presentation only.
 *
 * The authorized client set is the registry aggregate already on screen
 * (period, workspace and active filters). This does not query another client
 * source and does not decide visibility. It narrows those rows for the dropdown
 * with the same fields the registry `q` read uses: client name and ready-to-render
 * cell values, plus tax id when the aggregate exposes it on the row.
 *
 * Confirming a suggestion or pressing Enter still applies `q` through the
 * existing aggregate read. Suggestions never write.
 */

export type ClientOperationsSearchSuggestionSource = {
  client_id: string;
  client_name: string | null;
  tax_id?: string | null;
  cells?: Record<string, string> | null;
};

export type ClientOperationsSearchSuggestion = {
  client_id: string;
  client_name: string;
  identifier: string | null;
  /** Token for the existing registry `q` contract. Empty when no name or cell can carry it. */
  query: string;
};

function includesQuery(value: string | null | undefined, q: string): boolean {
  return String(value ?? '').toLowerCase().includes(q);
}

function matchingCellValue(
  cells: Record<string, string> | null | undefined,
  q: string,
): string | null {
  if (!cells) return null;
  for (const [key, value] of Object.entries(cells)) {
    if (key === 'client_name') continue;
    if (!value) continue;
    if (includesQuery(value, q)) return value;
  }
  return null;
}

/** Case-insensitive suggestions from the current aggregate. Empty query yields none. */
export function matchClientOperationsRegistrySuggestions(
  rows: readonly ClientOperationsSearchSuggestionSource[],
  rawQuery: string,
): ClientOperationsSearchSuggestion[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];
  const out: ClientOperationsSearchSuggestion[] = [];
  for (const row of rows) {
    if (!row.client_id) continue;
    const name = String(row.client_name ?? '').trim();
    const nameHit = includesQuery(name, q);
    const cellHit = matchingCellValue(row.cells, q);
    const taxId = String(row.tax_id ?? '').trim();
    const taxHit = !nameHit && !cellHit && includesQuery(taxId, q);
    if (!nameHit && !cellHit && !taxHit) continue;
    const identifier = cellHit || (taxHit ? taxId : taxId && taxId !== name ? taxId : null);
    const query = name || cellHit || (taxHit ? taxId : '');
    out.push({
      client_id: row.client_id,
      client_name: name || identifier || row.client_id,
      identifier: identifier && identifier !== (name || row.client_id) ? identifier : null,
      query,
    });
  }
  return out;
}

/** Arrow keys. -1 means no highlighted suggestion (Enter confirms the typed text). */
export function moveClientOperationsSearchSuggestionIndex(
  current: number,
  delta: 1 | -1,
  length: number,
): number {
  if (length <= 0) return -1;
  if (delta === 1) return current >= length - 1 ? length - 1 : current + 1;
  return current <= 0 ? -1 : current - 1;
}
