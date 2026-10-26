export function refreshSessionMatchesCaller(input: {
  refreshedAuthUserId?: string | null;
  callerAuthUserId?: string | null;
  callerStatus?: string | null;
}): boolean {
  const refreshed = String(input.refreshedAuthUserId ?? '');
  const caller = String(input.callerAuthUserId ?? '');
  return Boolean(refreshed) && refreshed === caller && input.callerStatus === 'active';
}
