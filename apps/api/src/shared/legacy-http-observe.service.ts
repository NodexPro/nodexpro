import { config } from '../config.js';
import { supabaseAdmin } from '../db/client.js';
import type { RequestContext } from './context.js';
import { assertPlatformOwner } from './platform-owner.js';
import { AUDIT_ACTIONS, writeAudit } from './audit-events.js';
import {
  LEGACY_HTTP_OBSERVE_RETENTION_DAYS,
  summarizeLegacyHttpObservations,
  type LegacyHttpObservationRow,
} from './legacy-http-observe.pure.js';

const SELECT_COLUMNS =
  'endpoint_key,http_method,http_status,observed_at,has_authorization,origin_pull_verified';

const RETENTION_MS = LEGACY_HTTP_OBSERVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const IN_PROCESS_PURGE_MS = 6 * 60 * 60 * 1000;

function retentionCutoffIso(nowMs = Date.now()): string {
  return new Date(nowMs - RETENTION_MS).toISOString();
}

export async function purgeLegacyHttpObservations(nowMs = Date.now()): Promise<{ deleted: number; cutoff: string }> {
  const cutoff = retentionCutoffIso(nowMs);
  try {
    const result = await supabaseAdmin
      .from('legacy_http_observations')
      .delete()
      .lt('observed_at', cutoff)
      .select('id');
    if (result.error) return { deleted: 0, cutoff };
    return { deleted: Array.isArray(result.data) ? result.data.length : 0, cutoff };
  } catch {
    return { deleted: 0, cutoff };
  }
}

export function startLegacyHttpObservationRetentionScheduler(): void {
  const run = (): void => {
    void purgeLegacyHttpObservations().catch(() => {
      /* retention must never affect request handling */
    });
  };
  setTimeout(run, 60_000);
  const timer = setInterval(run, IN_PROCESS_PURGE_MS);
  timer.unref?.();
}

export async function recordLegacyHttpObservation(row: LegacyHttpObservationRow): Promise<void> {
  const inserted = await supabaseAdmin.from('legacy_http_observations').insert({
    endpoint_key: row.endpoint_key,
    http_method: row.http_method,
    http_status: row.http_status,
    observed_at: row.observed_at,
    has_authorization: row.has_authorization,
    origin_pull_verified: row.origin_pull_verified,
  });
  if (inserted.error) return;
  await purgeLegacyHttpObservations();
}

export async function buildOwnerLegacyHttpObservationsAggregate(ctx: RequestContext) {
  assertPlatformOwner(ctx);
  const since = retentionCutoffIso();
  const query = await supabaseAdmin
    .from('legacy_http_observations')
    .select(SELECT_COLUMNS)
    .gte('observed_at', since)
    .order('observed_at', { ascending: false })
    .limit(5000);

  const storageReady = !query.error;
  const rows = storageReady && Array.isArray(query.data) ? (query.data as LegacyHttpObservationRow[]) : [];
  const aggregate = summarizeLegacyHttpObservations(rows, new Date().toISOString(), {
    storageReady,
    observationWritesEnabled: config.legacyHttpObserveEnabled,
  });

  try {
    await writeAudit({
      organizationId: null,
      actorUserId: ctx.user.id,
      entityType: 'legacy_http_observations',
      action: AUDIT_ACTIONS.LEGACY_HTTP_OBSERVATIONS_READ,
      payload: {
        count: aggregate.totals.count,
        storage_ready: storageReady,
      },
      ipAddress: null,
      userAgent: null,
    });
  } catch {
    /* operator read still returns even if audit insert is unavailable */
  }

  return aggregate;
}
