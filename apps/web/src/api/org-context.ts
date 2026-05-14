/**
 * Last active organization id returned from GET /auth/session (Core aggregate).
 * apiFetch reads this so X-Organization-Id matches backend truth — not sessionStorage.
 */
let backendActiveOrganizationId: string | null = null;

export function setBackendActiveOrganizationId(id: string | null | undefined): void {
  if (typeof id === 'string' && id.trim()) backendActiveOrganizationId = id.trim();
  else backendActiveOrganizationId = null;
}

export function getBackendActiveOrganizationId(): string | null {
  return backendActiveOrganizationId;
}
