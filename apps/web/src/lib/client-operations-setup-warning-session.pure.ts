export const CLIENT_OPERATIONS_SETUP_WARNING_STORAGE_PREFIX = 'nx-co-setup-warning';

export function setupWarningStorageKey(organizationId: string): string {
  return `${CLIENT_OPERATIONS_SETUP_WARNING_STORAGE_PREFIX}:${String(organizationId ?? '').trim()}`;
}

export function shouldShowSetupWarning(input: {
  count: number;
  fingerprint: string;
  dismissedFingerprint: string | null | undefined;
}): boolean {
  if (!Number.isFinite(input.count) || input.count <= 0) return false;
  const fingerprint = String(input.fingerprint ?? '').trim();
  if (!fingerprint) return false;
  return String(input.dismissedFingerprint ?? '').trim() !== fingerprint;
}
