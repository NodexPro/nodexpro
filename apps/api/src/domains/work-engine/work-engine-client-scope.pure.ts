/** Stage 5.5 — pure Work Engine client-scope helpers (see work-engine-client-scope.ts for the count classification). */

/** PostgREST `or` filter fragment for a work-engine row's client column. */
export function clientScopeOrFilter(allowed: readonly string[], column = 'client_id'): string {
  if (allowed.length === 0) return `${column}.is.null`;
  return `${column}.is.null,${column}.in.(${allowed.join(',')})`;
}

/** Apply the allow-list to any query exposing `or(...)` (null = unchanged). */
export function scopeQueryToAllowedClients<Q extends { or: (filters: string) => Q }>(
  query: Q,
  allowed: readonly string[] | null,
  column = 'client_id',
): Q {
  if (allowed === null) return query;
  return query.or(clientScopeOrFilter(allowed, column));
}

/** Pure row-level equivalent for rows already in memory. */
export function rowClientAllowed(
  clientId: string | null | undefined,
  allowed: readonly string[] | null,
): boolean {
  if (allowed === null) return true;
  const id = String(clientId ?? '').trim();
  if (!id) return true;
  return allowed.includes(id);
}
