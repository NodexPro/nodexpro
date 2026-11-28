export const CLIENT_OPERATIONS_SETUP_WARNING_DISMISSED_COMMAND =
  'set_client_operations_setup_warning_dismissed';

/** Mirrors backend setupWarningVisible — FE only uses aggregate.visible at runtime. */
export function shouldShowSetupWarning(input: {
  count: number;
  clientsAddedToken: string;
  dismissedClientsAddedToken: string | null | undefined;
}): boolean {
  if (!Number.isFinite(input.count) || input.count <= 0) return false;
  const dismissed = String(input.dismissedClientsAddedToken ?? '').trim();
  if (!dismissed || !/^\d+$/.test(dismissed)) return true;
  const current = String(input.clientsAddedToken ?? '').trim();
  if (!/^\d+$/.test(current)) return true;
  return BigInt(current) > BigInt(dismissed);
}
