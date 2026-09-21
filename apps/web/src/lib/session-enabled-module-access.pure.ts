/**
 * Canonical tenant-session module availability (dumb UI helper).
 * Truth comes from session `enabledModules` (backend already applied modules.is_active + entitlement).
 * Do not invent a second global flag or fetch modules from the client.
 */
export function isSessionModuleEnabled(
  enabledModules: readonly string[] | null | undefined,
  moduleCode: string
): boolean {
  const code = moduleCode.trim().toLowerCase();
  if (!code) return false;
  return (enabledModules ?? []).some((m) => String(m).trim().toLowerCase() === code);
}
