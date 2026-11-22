/**
 * Working organization id for this tab.
 * JWT remains origin-wide via Supabase Auth. Tenant access is still membership-checked
 * on the backend. sessionStorage persistence lives in tab-workspace.pure.ts.
 */
let backendActiveOrganizationId: string | null = null;
let workspaceGeneration = 0;

export function bumpWorkspaceGeneration(): void {
  workspaceGeneration += 1;
}

export function setBackendActiveOrganizationId(id: string | null | undefined): void {
  const next = typeof id === 'string' && id.trim() ? id.trim() : null;
  if (next === backendActiveOrganizationId) return;
  backendActiveOrganizationId = next;
  bumpWorkspaceGeneration();
}

export function getBackendActiveOrganizationId(): string | null {
  return backendActiveOrganizationId;
}

export function getWorkspaceGeneration(): number {
  return workspaceGeneration;
}
