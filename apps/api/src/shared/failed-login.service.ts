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
  failedLoginStage,
  maskAttemptedIdentifier,
  normalizeLoginStamp,
  shouldApplyFailedLoginCooldown,
  shouldCreateFailedLoginIncident,
  shouldNotifyOwnerForFailedLogin,
} from './failed-login-policy.pure.js';
import { displaySourceIp } from './trusted-proxy.pure.js';
import { processSecurityAlertDeliveries } from './security-alert-delivery.service.js';

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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
}): Promise<{ stage: ReturnType<typeof failedLoginStage>; count: number; retryAfterSeconds: number; cooldown: boolean }> {
  const displayIp = displaySourceIp(input.sourceIp);
  const stamp = normalizeLoginStamp(input.loginStamp);
  const patternKey = hashValue(`login-pattern:${displayIp}:${String(input.userAgent ?? '').slice(0, 80)}`).slice(0, 40);
  const stampKey = stamp ? hashValue(`login-stamp:${stamp}`).slice(0, 40) : null;
  const identifier = maskAttemptedIdentifier(input.attemptedEmail);
  const identifierHash = input.attemptedEmail ? hashValue(String(input.attemptedEmail).trim().toLowerCase()) : null;
  const targetKey = identifierHash ? hashValue(`login-target:${identifierHash}`).slice(0, 40) : null;
  const patternCount = await consumeBucket(patternKey, FAILED_LOGIN_WINDOW_SECONDS, 1000);
  const stampCount = stampKey ? await consumeBucket(stampKey, FAILED_LOGIN_WINDOW_SECONDS, 1000) : 0;
  const targetCount = targetKey ? await consumeBucket(targetKey, FAILED_LOGIN_WINDOW_SECONDS, 1000) : 0;
  const counts = failedLoginCorrelationCounts({ patternCount, stampCount, targetCount });
  const count = counts.detectionCount;
  const distinctTargets = await consumeBucket(
    hashValue(`login-targets:${stampKey ?? displayIp}`).slice(0, 40),
    FAILED_LOGIN_WINDOW_SECONDS,
    1000,
  );
  const stage = failedLoginStage(count);
  const cooldown = shouldApplyFailedLoginCooldown({
    countInWindow: counts.cooldownCount,
    loginSucceeded: input.loginSucceeded,
    isPlatformOwnerEmergency: input.isPlatformOwnerEmergency,
  });
  let retryAfterSeconds = 0;
  if (cooldown) {
    await consumeBucket(`cd:${stampKey ?? patternKey}`.slice(0, 40), FAILED_LOGIN_COOLDOWN_SECONDS, 1000);
    retryAfterSeconds = FAILED_LOGIN_COOLDOWN_SECONDS;
  }
  const geo = await enrichGeoIp(input.sourceIp);
  const detectionReason = failedLoginDetectionReason(stage, distinctTargets);
  const groupKey = failedLoginGroupKey({
    displayIp,
    attemptedIdentifierHash: identifierHash,
    stampHash: stampKey,
  });
  const notify = shouldNotifyOwnerForFailedLogin(counts.incidentCount);
  const actorKey = stampKey ?? identifierHash ?? displayIp;
  const incident = shouldCreateFailedLoginIncident(counts.incidentCount)
    ? await handleSecurityDetection({
        action: 'security.login_failed',
        dedupeKey: securitySubjectKey(`login-actor:${actorKey}`),
        sourceIp: input.sourceIp,
        correlationId: input.correlationId ?? null,
        incidentReady: true,
        safeContext: {
          attempt_count: count,
          distinct_targets: distinctTargets,
          display_ip: displayIp,
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
  });
  await writeAudit({
    organizationId: null,
    actorUserId: null,
    entityType: 'security',
    action: 'security.login_failed',
    payload,
  });
  await supabaseAdmin.from('security_journal_entries').insert({
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
  });
  if (notify) {
    await enqueueSecurityAlert({
      eventAction: 'security.login_failed',
      severity: 'high',
      eventKind: 'security',
      dedupeKey: `alert:login-actor:${actorKey}:incident`,
      correlationId: input.correlationId ?? null,
      safeContext: payload,
    }).catch(() => undefined);
    await processSecurityAlertDeliveries(5).catch(() => undefined);
  }
  return { stage, count, retryAfterSeconds, cooldown };
}
