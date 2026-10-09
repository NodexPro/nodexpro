/**
 * Stage 5.5 — Work Engine client scope for counts, catalogs and lists.
 *
 * Count classification (every Work Engine summary number goes through this helper):
 *  - A (worker operational, client-scoped): state counts, bucket counts (assigned/unassigned/claimed/
 *    review), invoice-attention counts, reminder-review counts, pending-mapping counts + rows,
 *    filter catalog, recent items. Restricted Staff/Viewer see only rows whose client is in the
 *    Stage 5.1 allow-list (clientless work items keep their existing organization semantics).
 *  - C (office administration): failed-operations summary (delivery/PDF/posting failures with client
 *    labels). Never served to a client-restricted caller.
 *  - B (org-level non-sensitive): none in Work Engine.
 * Owner/Admin and ALL-access members get a null allow-list and keep unchanged office behavior.
 */

import { authorizedClientIdsForViewer } from '../client-operations/organization-client-access.js';

export type WorkEngineClientScopeViewer = {
  userId: string;
  roleCode?: string | null;
};

/** null = unrestricted; array = Stage 5.1 allow-list (empty = no clients). */
export async function workEngineAllowedClientIds(
  orgId: string,
  viewer: WorkEngineClientScopeViewer | null | undefined,
): Promise<string[] | null> {
  // No viewer context = internal/system read (unchanged). Route layer always passes a viewer.
  if (!viewer?.userId) return null;
  return authorizedClientIdsForViewer({
    organizationId: orgId,
    userId: viewer.userId,
    roleCode: viewer.roleCode ?? null,
  });
}

export { clientScopeOrFilter, rowClientAllowed, scopeQueryToAllowedClients } from './work-engine-client-scope.pure.js';
