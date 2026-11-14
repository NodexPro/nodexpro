/** Filing command persistence gate. Success requires a real updated row. */

export function obligationWritePersisted(input: {
  error: unknown;
  rowCount: number;
}): boolean {
  return input.error == null && input.rowCount > 0;
}
