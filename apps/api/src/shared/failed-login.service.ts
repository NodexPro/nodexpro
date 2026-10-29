import { createHash } from 'node:crypto';
import { supabaseAdmin } from '../db/client.js';
import { writeAudit } from './audit-events.js';
import { enqueueSecurityAlert } from './security-alert-delivery.service.js';
import { handleSecurityDetection } from './security-containment.service.js';
import { enrichGeoIp } from './geoip-dbip.service.js';
import { safeSecurityPayload } from './security-event.pure.js';
import { securitySubjectKey } from './security-event.service.js';
import {
  FAILED_LOGIN_COOLDOWN_SECONDS,
  FAILED_LOGIN_WINDOW_SECONDS,
  failedLoginCorrelationCounts,
  failedLoginDetectionReason,
  failedLoginGroupKey,
  failedLoginSeverity,
  failedLoginSourceCooldown,
  failedLoginStage,
  loginNetworkPrefix,
  maskAttemptedIdentifier,
  normalizeLoginStamp,
  shouldCreateDistributedLoginIncident,
  shouldCreateFailedLoginIncident,
  shouldNotifyOwnerForFailedLogin,
  shouldOfferPasswordRecoveryFromSource,
} from './failed-login-policy.pure.js';
import { officeAlertDedupeKey } from './office-login-alert.pure.js';
import { geoIpUnavailable } from './request-source.pure.js';
import { displaySourceIp } from './trusted-proxy.pure.js';
import { processSecurityAlertDeliveries } from './security-alert-delivery.service.js';

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function peekBucket(key: string, windowSeconds: number): Promise<number> {
  try {
    const read = await supabaseAdmin
      .from('security_rate_buckets')
      .select('request_count, window_started_at')
      .eq('bucket_key', key)
      .maybeSingle();
    if (read.error || !read.data) return 0;
    const started = Date.parse(String(read.data.window_started_at ?? ''));
    if (!Number.isFinite(started) || Date.now() - started > windowSeconds * 1000) return 0;
    return Math.max(0, Number(read.data.request_count ?? 0));
  } catch {
    return 0;
  }
}

function correlationKeys(input: { sourceIp: string | null; userAgent?: string | null; loginStamp?: string | null; attemptedEmail?: string | null }) {
  const displayIp = displaySourceIp(input.sourceIp);
  const stamp = normalizeLoginStamp(input.loginStamp);
  const patternKey = hashValue(`login-pattern:${displayIp}:${String(input.userAgent ?? '').slice(0, 80)}`).slice(0, 40);
  const stampKey = stamp ? hashValue(`login-stamp:${stamp}`).slice(0, 40) : null;
  const identifierHash = input.attemptedEmail ? hashValue(String(input.attemptedEmail).trim().toLowerCase()) : null;
  const verifiedIp = displayIp !== 'Unknown';
  const ipKey = verifiedIp ? hashValue(`login-ip:${displayIp}`).slice(0, 40) : null;
  const networkPrefix = loginNetworkPrefix(displayIp);
  const networkKey = networkPrefix ? hashValue(`login-net:${networkPrefix}`).slice(0, 40) : null;
  return {
    displayIp,
    stamp,
    patternKey,
    stampKey,
    identifierHash,
    cooldownKey: `cd:${stampKey ?? patternKey}`.slice(0, 40),
    ipKey,
    ipCooldownKey: ipKey ? `cdip:${ipKey}`.slice(0, 40) : null,
    networkKey,
    unknownKey: verifiedIp ? null : hashValue('login-unknown-source').slice(0, 40),
    unknownCooldownKey: verifiedIp ? null : 'cdunk:login-unknown-source'.slice(0, 40),
    endpointKey: hashValue('login-endpoint').slice(0, 40),
  };
}

export async function isFailedLoginCooldownActive(input: {
  sourceIp: string | null;
  userAgent?: string | null;
  loginStamp?: string | null;
}): Promise<boolean> {
  const keys = correlationKeys(input);
  const layers = await Promise.all([
    peekBucket(keys.cooldownKey, FAILED_LOGIN_COOLDOWN_SECONDS),
    keys.ipCooldownKey ? peekBucket(keys.ipCooldownKey, FAILED_LOGIN_COOLDOWN_SECONDS) : Promise.resolve(0),
    keys.unknownCooldownKey ? peekBucket(keys.unknownCooldownKey, FAILED_LOGIN_COOLDOWN_SECONDS) : Promise.resolve(0),
  ]);
  return layers.some((count) => count >= 1);
}

export async function recentFailedLoginCount(input: {
  sourceIp: string | null;
  userAgent?: string | null;
  loginStamp?: string | null;
}): Promise<number> {
  const keys = correlationKeys(input);
  const [patternCount, stampCount] = await Promise.all([
    peekBucket(keys.patternKey, FAILED_LOGIN_WINDOW_SECONDS),
    keys.stampKey ? peekBucket(keys.stampKey, FAILED_LOGIN_WINDOW_SECONDS) : Promise.resolve(0),
  ]);
  return Math.max(patternCount, stampCount);
}

export async function listOfficeOwnersForEmail(email: string): Promise<Array<{ organizationId: string }>> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return [];
  const user = await supabaseAdmin.from('users').select('id').eq('email', normalized).maybeSingle();
  if (user.error || !user.data?.id) return [];
  const memberships = await supabaseAdmin
    .from('organization_memberships')
    .select('organization_id')
    .eq('user_id', user.data.id)
    .eq('status', 'active');
  const orgIds = [...new Set((memberships.data ?? []).map((row) => String(row.organization_id ?? '')).filter(Boolean))];
  return orgIds.map((organizationId) => ({ organizationId }));
}

async function consumeBucket(key: string, windowSeconds: number, max: number): Promise<number> {
  try {
    const rpc = await supabaseAdmin.rpc('consume_security_rate_bucket', {
      p_key: key,
      p_window_seconds: windowSeconds,
      p_max: max,
    });
    if (rpc.error) return 1;
    const row = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as { request_count?: number } | null;
    return Math.max(1, Number(row?.request_count ?? 1));
  } catch {
    return 1;
  }
}

export async function recordFailedLoginAttempt(input: {
  sourceIp: string | null;
  userAgent?: string | null;
  attemptedEmail?: string | null;
  loginStamp?: string | null;
  correlationId?: string | null;
  loginSucceeded: boolean;
  isPlatformOwnerEmergency: boolean;
}): Promise<{
  stage: ReturnType<typeof failedLoginStage>;
  count: number;
  retryAfterSeconds: number;
  cooldown: boolean;
  offerRecovery: boolean;
}> {
  const keys = correlationKeys(input);
  const displayIp = keys.displayIp;
  const identifier = maskAttemptedIdentifier(input.attemptedEmail);
  const identifierHash = keys.identifierHash;
  const targetKey = identifierHash ? hashValue(`login-target:${identifierHash}`).slice(0, 40) : null;
  // Independent rate-bucket keys — consume in one wave. Cooldown buckets stay AFTER the
  // cooldown decision (they are a side effect of that decision, not an input to it).
  const geoPromise =
    displayIp === 'Unknown' ? Promise.resolve(geoIpUnavailable(null)) : enrichGeoIp(input.sourceIp);
  const [
    patternCount,
    stampCount,
    targetCount,
    verifiedIpCount,
    networkCount,
    unknownSourceCount,
    endpointCount,
    distinctTargets,
    geo,
  ] = await Promise.all([
    consumeBucket(keys.patternKey, FAILED_LOGIN_WINDOW_SECONDS, 1000),
    keys.stampKey ? consumeBucket(keys.stampKey, FAILED_LOGIN_WINDOW_SECONDS, 1000) : Promise.resolve(0),
    targetKey ? consumeBucket(targetKey, FAILED_LOGIN_WINDOW_SECONDS, 1000) : Promise.resolve(0),
    keys.ipKey ? consumeBucket(keys.ipKey, FAILED_LOGIN_WINDOW_SECONDS, 1000) : Promise.resolve(0),
    keys.networkKey ? consumeBucket(keys.networkKey, FAILED_LOGIN_WINDOW_SECONDS, 1000) : Promise.resolve(0),
    keys.unknownKey ? consumeBucket(keys.unknownKey, FAILED_LOGIN_WINDOW_SECONDS, 1000) : Promise.resolve(0),
    consumeBucket(keys.endpointKey, FAILED_LOGIN_WINDOW_SECONDS, 10000),
    consumeBucket(
      hashValue(`login-targets:${keys.ipKey ?? keys.stampKey ?? displayIp}`).slice(0, 40),
      FAILED_LOGIN_WINDOW_SECONDS,
      1000,
    ),
    geoPromise,
  ]);
  const counts = failedLoginCorrelationCounts({ patternCount, stampCount, targetCount });
  const count = counts.detectionCount;
  const stage = failedLoginStage(Math.max(count, verifiedIpCount, unknownSourceCount));
  const cooldown = failedLoginSourceCooldown({
    stampOrPatternCount: counts.cooldownCount,
    verifiedIpCount,
    unknownSourceCount,
    loginSucceeded: input.loginSucceeded,
    isPlatformOwnerEmergency: input.isPlatformOwnerEmergency,
  });
  let retryAfterSeconds = 0;
  if (cooldown) {
    await Promise.all([
      consumeBucket(keys.cooldownKey, FAILED_LOGIN_COOLDOWN_SECONDS, 1000),
      keys.ipCooldownKey
        ? consumeBucket(keys.ipCooldownKey, FAILED_LOGIN_COOLDOWN_SECONDS, 1000)
        : Promise.resolve(0),
      keys.unknownCooldownKey
        ? consumeBucket(keys.unknownCooldownKey, FAILED_LOGIN_COOLDOWN_SECONDS, 1000)
        : Promise.resolve(0),
    ]);
    retryAfterSeconds = FAILED_LOGIN_COOLDOWN_SECONDS;
  }
  const detectionReason = failedLoginDetectionReason(stage, distinctTargets);
  const groupKey = failedLoginGroupKey({
    displayIp,
    attemptedIdentifierHash: identifierHash,
    stampHash: keys.stampKey,
  });
  const distributed = shouldCreateDistributedLoginIncident({
    verifiedIpCount,
    networkCount,
    unknownSourceCount,
    endpointCount,
    distinctTargets,
    stampOrPatternCount: counts.cooldownCount,
  });
  const notify = shouldNotifyOwnerForFailedLogin(counts.incidentCount) || distributed;
  const actorKey = keys.stampKey ?? identifierHash ?? displayIp;
  const incident = shouldCreateFailedLoginIncident(counts.incidentCount) || distributed
    ? await handleSecurityDetection({
        action: distributed ? 'security.login_distributed' : 'security.login_failed',
        dedupeKey: securitySubjectKey(distributed ? `login-distributed:${keys.ipKey ?? keys.unknownKey ?? 'global'}` : `login-actor:${actorKey}`),
        sourceIp: input.sourceIp,
        correlationId: input.correlationId ?? null,
        incidentReady: true,
        safeContext: {
          attempt_count: count,
          distinct_targets: distinctTargets,
          display_ip: displayIp,
          endpoint_count: endpointCount,
        },
      })
    : { incidentId: null, contained: false, countInWindow: count };
  const payload = safeSecurityPayload({
    attempt_count: count,
    detection_reason: detectionReason,
    display_ip: displayIp,
    cooldown_status: cooldown ? 'active' : 'none',
    country: geo.country,
    city: geo.city,
    source_ip: displayIp === 'Unknown' ? null : displayIp,
    correlation_id: input.correlationId ?? null,
    masked_target: identifier,
  });
  await Promise.all([
    writeAudit({
      organizationId: null,
      actorUserId: null,
      entityType: 'security',
      action: 'security.login_failed',
      payload,
    }),
    supabaseAdmin.from('security_journal_entries').insert({
      action: 'security.login_failed',
      severity: failedLoginSeverity(stage),
      event_type: stage === 'incident' ? 'repeated_failed_login_attempts' : 'failed_login',
      source_ip: displayIp === 'Unknown' ? null : displayIp,
      display_ip: displayIp,
      country: geo.country,
      city: geo.city,
      attempted_identifier: identifier,
      attempted_identifier_hash: identifierHash,
      attempt_count: count,
      detection_reason: detectionReason,
      incident_id: incident.incidentId,
      cooldown_status: cooldown ? 'active' : 'none',
      containment_action: 'none',
      alert_status: notify ? 'queued' : 'not_required',
      group_key: groupKey,
      correlation_id: input.correlationId ?? null,
    }).then(({ error }) => {
      if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
        return writeAudit({
          organizationId: null,
          actorUserId: null,
          entityType: 'security',
          action: 'security.journal_write_failed',
          payload: { code: error.code ?? 'unknown' },
        }).catch(() => undefined);
      }
      return undefined;
    }),
  ]);
  if (notify) {
    await enqueueSecurityAlert({
      eventAction: distributed ? 'security.login_distributed' : 'security.login_failed',
      severity: 'high',
      eventKind: 'security',
      dedupeKey: distributed
        ? `alert:login-distributed:${keys.ipKey ?? keys.unknownKey ?? 'global'}`
        : `alert:login-actor:${actorKey}:incident`,
      correlationId: input.correlationId ?? null,
      safeContext: payload,
    }).catch(() => undefined);
    if (!distributed && input.attemptedEmail) {
      const offices = await listOfficeOwnersForEmail(input.attemptedEmail).catch(() => []);
      for (const office of offices) {
        await enqueueSecurityAlert({
          eventAction: 'security.login_failed',
          severity: 'high',
          eventKind: 'security',
          dedupeKey: officeAlertDedupeKey(office.organizationId, actorKey),
          correlationId: input.correlationId ?? null,
          safeContext: {
            ...payload,
            audience: 'office',
            organization_id: office.organizationId,
            masked_target: identifier,
          },
        }).catch(() => undefined);
      }
    }
    await processSecurityAlertDeliveries(5).catch(() => undefined);
  }
  return {
    stage,
    count,
    retryAfterSeconds,
    cooldown,
    offerRecovery: shouldOfferPasswordRecoveryFromSource(counts.cooldownCount),
  };
}
