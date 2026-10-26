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
  failedLoginDetectionReason,
  failedLoginGroupKey,
  failedLoginSeverity,
  failedLoginStage,
  maskAttemptedIdentifier,
  shouldApplyFailedLoginCooldown,
  shouldCreateFailedLoginIncident,
  shouldNotifyOwnerForFailedLogin,
} from './failed-login-policy.pure.js';
import { displaySourceIp } from './trusted-proxy.pure.js';

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
  correlationId?: string | null;
  loginSucceeded: boolean;
  isPlatformOwnerEmergency: boolean;
}): Promise<{ stage: ReturnType<typeof failedLoginStage>; count: number; retryAfterSeconds: number; cooldown: boolean }> {
  const displayIp = displaySourceIp(input.sourceIp);
  const patternKey = hashValue(`login-pattern:${displayIp}:${String(input.userAgent ?? '').slice(0, 80)}`).slice(0, 40);
  const identifier = maskAttemptedIdentifier(input.attemptedEmail);
  const identifierHash = input.attemptedEmail ? hashValue(String(input.attemptedEmail).trim().toLowerCase()) : null;
  const count = await consumeBucket(patternKey, FAILED_LOGIN_WINDOW_SECONDS, 1000);
  const distinctTargets = await consumeBucket(
    hashValue(`login-targets:${displayIp}`).slice(0, 40),
    FAILED_LOGIN_WINDOW_SECONDS,
    1000,
  );
  const stage = failedLoginStage(count);
  const cooldown = shouldApplyFailedLoginCooldown({
    countInWindow: count,
    loginSucceeded: input.loginSucceeded,
    isPlatformOwnerEmergency: input.isPlatformOwnerEmergency,
  });
  let retryAfterSeconds = 0;
  if (cooldown) {
    const coolCount = await consumeBucket(`cd:${patternKey}`.slice(0, 40), FAILED_LOGIN_COOLDOWN_SECONDS, 1000);
    retryAfterSeconds = FAILED_LOGIN_COOLDOWN_SECONDS;
    if (coolCount > 1) retryAfterSeconds = FAILED_LOGIN_COOLDOWN_SECONDS;
  }
  const geo = await enrichGeoIp(input.sourceIp);
  const detectionReason = failedLoginDetectionReason(stage, distinctTargets);
  const groupKey = failedLoginGroupKey({ displayIp, attemptedIdentifierHash: identifierHash });
  const notify = shouldNotifyOwnerForFailedLogin(count);
  const incident = shouldCreateFailedLoginIncident(count)
    ? await handleSecurityDetection({
        action: 'security.login_failed',
        dedupeKey: securitySubjectKey(`login-pattern:${displayIp}`),
        sourceIp: input.sourceIp,
        correlationId: input.correlationId ?? null,
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
      dedupeKey: `alert:login-pattern:${displayIp}:incident`,
      correlationId: input.correlationId ?? null,
      safeContext: payload,
    }).catch(() => undefined);
  }
  return { stage, count, retryAfterSeconds, cooldown };
}
