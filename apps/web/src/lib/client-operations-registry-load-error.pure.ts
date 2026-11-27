/**
 * Client Operations registry load failures that must not paint as "open failed".
 * Presentation only: abort / superseded workspace / quiet refresh after a cache paint.
 */

export function isIgnorableClientOperationsRegistryLoadFailure(input: {
  error: unknown;
  signalAborted?: boolean;
  quiet?: boolean;
  paintedFromCache?: boolean;
}): boolean {
  if (input.signalAborted === true) return true;
  const name =
    input.error && typeof input.error === 'object' && 'name' in input.error
      ? String((input.error as { name?: unknown }).name ?? '')
      : '';
  if (name === 'AbortError' || name === 'StaleWorkspaceError') return true;
  if (input.quiet === true && input.paintedFromCache === true) return true;
  return false;
}
