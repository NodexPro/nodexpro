/**
 * Client Operations registry — PRE-SEARCH materialization cache.
 *
 * Optimizes ONLY the expensive aggregate materialization that happens before the free-text
 * search (`q`) and sort are applied. The cached value is the canonical pre-search state
 * (built rows + columns + period + manual-row values); every request still runs the EXISTING
 * `applyRegistryQueryToRows` / `materializeClientOperationsManualRows(searchQ)` on top of it,
 * so search semantics are unchanged and there is no second source of truth.
 *
 * Safety contract:
 * - Auth / org / RBAC middleware runs on EVERY request before any cache lookup; auth success is
 *   never cached. The cache key is scoped by organization + client access scope + every dimension
 *   that changes the pre-search rows (period, default period, editor capability, normalized
 *   business filters).
 * - Access scope (OFFICE vs ASSIGNED:<userId>) is resolved from authenticated membership BEFORE
 *   cache lookup — Staff can never select or reuse an OFFICE cache entry.
 * - The key MUST NOT include `q`, `sort_by`, `sort_dir` (post-materialization concerns).
 * - Commands never read this cache (they always rebuild) and invalidate the org scope so a later
 *   GET cannot serve pre-mutation rows.
 * - Process-local + short TTL: staleness from writes performed outside this process (other API
 *   instances / other domains touching `clients`) is bounded by the TTL.
 */
import { BoundedTtlCache } from '../../shared/bounded-ttl-cache.js';
import type { ClientOperationsRegistryFiltersActive } from './client-operations-registry-filters.pure.js';
import type { ClientOperationsRegistryPreSearchMaterialization } from './client-operations.service.js';

export const CLIENT_OPERATIONS_REGISTRY_MATERIALIZATION_TTL_MS = 10_000;
/** (org × access-scope × period × filters × capability) tuples alive at once; oldest evicted first. */
export const CLIENT_OPERATIONS_REGISTRY_MATERIALIZATION_MAX_ENTRIES = 128;

const KEY_SEP = '\u001f';

export type ClientOperationsRegistryMaterializationCacheKeyInput = {
  organizationId: string;
  /** Canonical access scope identity from resolveOrganizationClientAccessScope (never FE-supplied). */
  accessScopeKey: string;
  /** Manual-row sheet identity. Separates OFFICE cells from a member sheet that shares a client scope key. */
  manualWorkspaceKey?: string;
  selectedPeriodKey: string;
  defaultPeriodKey: string;
  canEditRegistry: boolean;
  /** Normalized business filters (`normalizeClientOperationsRegistryBusinessFilterQuery`). */
  filters: ClientOperationsRegistryFiltersActive;
};

/** Org-scoped prefix — invalidation granularity. */
export function clientOperationsRegistryMaterializationCacheOrgPrefix(organizationId: string): string {
  return `${organizationId}${KEY_SEP}`;
}

/**
 * Every dimension that changes PRE-SEARCH rows, in a fixed order. Never `q` / sort.
 * Member module grants are enforced by requireModuleActive before this cache is read,
 * so a removed grant cannot reuse an entry on the next request.
 * Derived from `listClientOperationsRegistry` inputs: org scoping, access scope, selected +
 * default period (current-vs-historical branch), `client_operations.edit` (editable cells /
 * setup blocks), and the six business filters (early facet filtering).
 */
export function buildClientOperationsRegistryMaterializationCacheKey(
  input: ClientOperationsRegistryMaterializationCacheKeyInput,
): string {
  const f = input.filters;
  return [
    input.organizationId,
    'v2',
    input.accessScopeKey,
    input.manualWorkspaceKey ?? '',
    input.selectedPeriodKey,
    input.defaultPeriodKey,
    input.canEditRegistry ? 'edit' : 'view',
    f.operational_reporting,
    f.material,
    f.payroll,
    f.reporting_type,
    f.business_type,
    f.handler,
  ].join(KEY_SEP);
}

export const clientOperationsRegistryMaterializationCache =
  new BoundedTtlCache<ClientOperationsRegistryPreSearchMaterialization>({
    ttlMs: CLIENT_OPERATIONS_REGISTRY_MATERIALIZATION_TTL_MS,
    maxEntries: CLIENT_OPERATIONS_REGISTRY_MATERIALIZATION_MAX_ENTRIES,
  });

/** Drop every cached / in-flight materialization for an organization (after any CO write). */
export function invalidateClientOperationsRegistryMaterializationCache(
  organizationId: string | null | undefined,
): number {
  const orgId = String(organizationId ?? '').trim();
  if (!orgId) return 0;
  return clientOperationsRegistryMaterializationCache.invalidateByPrefix(
    clientOperationsRegistryMaterializationCacheOrgPrefix(orgId),
  );
}

/** Tests only. */
export function clearClientOperationsRegistryMaterializationCacheForTests(): void {
  clientOperationsRegistryMaterializationCache.clear();
}
