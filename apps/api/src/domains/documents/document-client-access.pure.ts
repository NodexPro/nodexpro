/**
 * Stage 5.5 — Document client ACL rules (pure).
 *
 * Rule: if `documents.primary_client_id` is non-null, a Staff/Viewer caller must have Stage 5.1
 * access to that client for EVERY operation that resolves the document by id (read, update, archive,
 * links, versions, download/open, activity, card). Documents without a client keep the existing
 * organization/document permission semantics.
 *
 * Client re-association (Client A -> Client B) never lets a restricted caller gain or expose
 * unauthorized client data:
 *   - source client (current primary_client_id) must be authorized, AND
 *   - target client must be authorized, AND
 *   - a restricted caller may not DETACH a client-owned document (null target), because that would
 *     turn a client-restricted document into an org-level one visible to members who lack the client.
 */

export type DocumentClientChangeDecision =
  | { ok: true }
  | { ok: false; reason: 'source_client_unauthorized' | 'target_client_unauthorized' | 'detach_not_allowed' };

export function evaluateDocumentClientChange(params: {
  /** null allow-list = unrestricted (Owner/Admin or ALL-access member). */
  allowedClientIds: readonly string[] | null;
  currentClientId: string | null | undefined;
  /** undefined = field not part of the change. */
  nextClientId: string | null | undefined;
}): DocumentClientChangeDecision {
  const { allowedClientIds } = params;
  if (allowedClientIds === null) return { ok: true };
  const allow = new Set(allowedClientIds);
  const current = String(params.currentClientId ?? '').trim() || null;
  if (current && !allow.has(current)) return { ok: false, reason: 'source_client_unauthorized' };
  if (params.nextClientId === undefined) return { ok: true };
  const next = String(params.nextClientId ?? '').trim() || null;
  if (next === null) {
    return current ? { ok: false, reason: 'detach_not_allowed' } : { ok: true };
  }
  if (!allow.has(next)) return { ok: false, reason: 'target_client_unauthorized' };
  return { ok: true };
}

/** Document is reachable for a caller: clientless docs keep existing semantics. */
export function documentClientAccessible(
  allowedClientIds: readonly string[] | null,
  primaryClientId: string | null | undefined,
): boolean {
  if (allowedClientIds === null) return true;
  const id = String(primaryClientId ?? '').trim();
  if (!id) return true;
  return allowedClientIds.includes(id);
}

/** Link rows pointing to clients the caller cannot access must not be exposed. */
export function restrictDocumentLinks<T extends { target_entity_type?: unknown; target_entity_id?: unknown }>(
  links: readonly T[],
  allowedClientIds: readonly string[] | null,
): T[] {
  if (allowedClientIds === null) return [...links];
  const allow = new Set(allowedClientIds);
  return links.filter((l) => {
    if (String(l.target_entity_type ?? '') !== 'client') return true;
    return allow.has(String(l.target_entity_id ?? ''));
  });
}
