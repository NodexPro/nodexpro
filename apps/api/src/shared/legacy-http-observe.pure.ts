/**
 * Privacy-safe matcher and summary for the seven Core legacy PATCH/PUT routes.
 * Observation only: no authorization, no mutation bypass, no tenant identifiers.
 */

export const LEGACY_HTTP_OBSERVE_RETENTION_DAYS = 90;
export const LEGACY_HTTP_OBSERVATIONS_AGGREGATE_KEY = 'legacy_http_observations_aggregate';

const SEGMENT = '[^/]+';

export const LEGACY_HTTP_ENDPOINT_CATALOG = [
  {
    method: 'PATCH',
    key: 'PATCH /organizations/:orgId/clients/:clientId',
    pattern: new RegExp(`^/api/v1/organizations/${SEGMENT}/clients/${SEGMENT}$`),
  },
  {
    method: 'PATCH',
    key: 'PATCH /organizations/:orgId/clients/:clientId/contacts/:contactId',
    pattern: new RegExp(`^/api/v1/organizations/${SEGMENT}/clients/${SEGMENT}/contacts/${SEGMENT}$`),
  },
  {
    method: 'PUT',
    key: 'PUT /organizations/:orgId/clients/:clientId/contacts/:contactId/primary',
    pattern: new RegExp(`^/api/v1/organizations/${SEGMENT}/clients/${SEGMENT}/contacts/${SEGMENT}/primary$`),
  },
  {
    method: 'PATCH',
    key: 'PATCH /organizations/:orgId/clients/:clientId/notes/:noteId',
    pattern: new RegExp(`^/api/v1/organizations/${SEGMENT}/clients/${SEGMENT}/notes/${SEGMENT}$`),
  },
  {
    method: 'PATCH',
    key: 'PATCH /organizations/:orgId/documents/:documentId',
    pattern: new RegExp(`^/api/v1/organizations/${SEGMENT}/documents/${SEGMENT}$`),
  },
  {
    method: 'PATCH',
    key: 'PATCH /organizations/:orgId/members/:memberId/role',
    pattern: new RegExp(`^/api/v1/organizations/${SEGMENT}/members/${SEGMENT}/role$`),
  },
  {
    method: 'PATCH',
    key: 'PATCH /organizations/:orgId/settings',
    pattern: new RegExp(`^/api/v1/organizations/${SEGMENT}/settings$`),
  },
] as const;

export type LegacyHttpEndpointKey = (typeof LEGACY_HTTP_ENDPOINT_CATALOG)[number]['key'];

export type LegacyHttpObservationRow = {
  endpoint_key: LegacyHttpEndpointKey | string;
  http_method: string;
  http_status: number;
  observed_at: string;
  has_authorization: boolean;
  origin_pull_verified: boolean;
  correlation_id?: string | null;
};

export function isLegacyHttpObserveEnabled(raw: string | null | undefined): boolean {
  return String(raw ?? 'true').trim().toLowerCase() !== 'false';
}

export function stripQueryAndFragment(raw: string | null | undefined): string {
  const value = String(raw ?? '');
  const withoutHash = value.split('#')[0] ?? '';
  return withoutHash.split('?')[0] ?? '';
}

export function normalizeLegacyHttpPath(raw: string | null | undefined): string {
  const path = stripQueryAndFragment(raw);
  if (path.startsWith('/api/v1/')) return path;
  if (path.startsWith('/organizations/')) return `/api/v1${path}`;
  return path;
}

export function matchLegacyHttpEndpoint(
  method: string | null | undefined,
  rawPath: string | null | undefined,
): { method: string; key: LegacyHttpEndpointKey } | null {
  const httpMethod = String(method ?? '').trim().toUpperCase();
  const path = normalizeLegacyHttpPath(rawPath);
  for (const endpoint of LEGACY_HTTP_ENDPOINT_CATALOG) {
    if (endpoint.method !== httpMethod) continue;
    if (endpoint.pattern.test(path)) return { method: endpoint.method, key: endpoint.key };
  }
  return null;
}

export function summarizeLegacyHttpObservations(
  rows: LegacyHttpObservationRow[],
  nowIso: string,
  options?: { storageReady?: boolean; observationWritesEnabled?: boolean },
) {
  const by_endpoint_key: Record<string, number> = {};
  const by_http_status: Record<string, number> = {};
  const by_http_method: Record<string, number> = {};
  let with_authorization = 0;
  let origin_pull_verified = 0;
  for (const row of rows) {
    by_endpoint_key[row.endpoint_key] = (by_endpoint_key[row.endpoint_key] ?? 0) + 1;
    const statusKey = String(row.http_status);
    by_http_status[statusKey] = (by_http_status[statusKey] ?? 0) + 1;
    by_http_method[row.http_method] = (by_http_method[row.http_method] ?? 0) + 1;
    if (row.has_authorization) with_authorization += 1;
    if (row.origin_pull_verified) origin_pull_verified += 1;
  }
  return {
    aggregate_key: LEGACY_HTTP_OBSERVATIONS_AGGREGATE_KEY,
    retention_days: LEGACY_HTTP_OBSERVE_RETENTION_DAYS,
    generated_at: nowIso,
    storage_ready: options?.storageReady ?? true,
    observation_writes_enabled: options?.observationWritesEnabled ?? true,
    totals: {
      count: rows.length,
      by_endpoint_key,
      by_http_status,
      by_http_method,
      with_authorization,
      without_authorization: rows.length - with_authorization,
      origin_pull_verified,
      origin_pull_not_verified: rows.length - origin_pull_verified,
    },
    recent: rows.slice(0, 200).map((row) => ({
      endpoint_key: row.endpoint_key,
      http_method: row.http_method,
      http_status: row.http_status,
      observed_at: row.observed_at,
      has_authorization: row.has_authorization,
      origin_pull_verified: row.origin_pull_verified,
      correlation_id: row.correlation_id ?? null,
    })),
  };
}
