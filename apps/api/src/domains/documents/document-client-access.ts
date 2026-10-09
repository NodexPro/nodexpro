import { forbidden } from '../../shared/errors.js';
import type { RequestContext } from '../../shared/context.js';
import { authorizedClientIdsForViewer } from '../client-operations/organization-client-access.js';
import {
  documentClientAccessible,
  evaluateDocumentClientChange,
  restrictDocumentLinks,
} from './document-client-access.pure.js';

/** Stage 5.1 allow-list for the caller. null = unrestricted. */
export async function documentClientAllowList(ctx: RequestContext): Promise<string[] | null> {
  if (!ctx.organizationId) throw forbidden('Organization context required');
  return authorizedClientIdsForViewer({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    roleCode: ctx.membership?.roleCode,
  });
}

/**
 * Central document ACL. Call after loading the document row (which MUST include primary_client_id).
 * Unauthorized client-owned documents are reported as "Document not found" (no existence leak).
 */
export async function assertDocumentClientAccess(
  ctx: RequestContext,
  primaryClientId: string | null | undefined,
  allowList?: string[] | null,
): Promise<string[] | null> {
  const allow = allowList === undefined ? await documentClientAllowList(ctx) : allowList;
  if (!documentClientAccessible(allow, primaryClientId)) throw forbidden('Document not found');
  return allow;
}

/** Validates a source -> target client change (update / link-as-primary / unlink-primary). */
export async function assertDocumentClientChange(
  ctx: RequestContext,
  params: { currentClientId: string | null | undefined; nextClientId: string | null | undefined },
  allowList?: string[] | null,
): Promise<void> {
  const allow = allowList === undefined ? await documentClientAllowList(ctx) : allowList;
  const decision = evaluateDocumentClientChange({
    allowedClientIds: allow,
    currentClientId: params.currentClientId,
    nextClientId: params.nextClientId,
  });
  if (decision.ok) return;
  if (decision.reason === 'source_client_unauthorized') throw forbidden('Document not found');
  if (decision.reason === 'target_client_unauthorized') throw forbidden('Client not found');
  throw forbidden('Insufficient permission to detach a client document');
}

export { restrictDocumentLinks };
