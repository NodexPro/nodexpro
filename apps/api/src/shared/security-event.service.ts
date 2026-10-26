import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { writeAudit } from './audit-events.js';
import { enqueueSecurityAlert } from './security-alert-delivery.service.js';
import { decideSecurityAlert, securityTestAlertBody } from './security-alert.pure.js';
import { securityAlertSeverity, shouldQueueSecurityAlert } from './security-alert-policy.pure.js';
import { decideSecurityRecord, safeSecurityPayload } from './security-event.pure.js';
import { enrichGeoIp } from './geoip-dbip.service.js';
import { resolveTrustedSourceIp } from './request-source.pure.js';
import { handleSecurityDetection } from './security-containment.service.js';

const WINDOW_MS = 10 * 60 * 1000;
type Bucket = { count: number; resetAt: number; repeatedWritten: boolean };
const buckets = new Map<string, Bucket>();

export function resetSecurityEventBucketsForTests(): void {
  buckets.clear();
}

export function securitySubjectKey(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export async function recordSecurityEvent(input: {
  action: string;
  dedupeKey: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  organizationId?: string | null;
  correlationId?: string | null;
  sourceIp?: string | null;
  payload?: Record<string, unknown> | null;
}): Promise<{ recorded: boolean }> {
  try {
    const now = Date.now();
    const existing = buckets.get(input.dedupeKey);
    const bucket = !existing || now > existing.resetAt
      ? { count: 0, resetAt: now + WINDOW_MS, repeatedWritten: false }
      : existing;
    bucket.count += 1;
    buckets.set(input.dedupeKey, bucket);
    const decision = decideSecurityRecord(bucket.count, input.action);
    if (!decision.record) return { recorded: false };
    if (decision.repeated && bucket.repeatedWritten) return { recorded: false };
    if (decision.repeated) bucket.repeatedWritten = true;
    const sourceIp = resolveTrustedSourceIp({ reqIp: input.sourceIp });
    const geo = await enrichGeoIp(sourceIp);
    const payload = safeSecurityPayload({
      ...(input.payload ?? {}),
      correlation_id: input.correlationId ?? null,
      repeated: decision.repeated,
      ...geo,
    });
    await writeAudit({
      organizationId: input.organizationId ?? null,
      actorUserId: input.actorUserId ?? null,
      entityType: 'security',
      action: decision.action,
      payload,
    });
    await handleSecurityDetection({
      action: decision.action,
      dedupeKey: input.dedupeKey,
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail ?? null,
      organizationId: input.organizationId ?? null,
      correlationId: input.correlationId ?? null,
      sourceIp,
      safeContext: payload,
    });
    if (shouldQueueSecurityAlert(decision.action)) {
      await enqueueSecurityAlert({
        eventAction: decision.action,
        severity: securityAlertSeverity(decision.action),
        eventKind: 'security',
        dedupeKey: `alert:${input.dedupeKey}:${decision.action}`,
        correlationId: input.correlationId ?? null,
        safeContext: payload,
      }).catch(() => undefined);
    }
    if (decision.repeated) await deliverSecurityAlert(decision.action, input.correlationId ?? null);
    return { recorded: true };
  } catch {
    return { recorded: false };
  }
}

export async function deliverSecurityTestAlert(correlationId: string): Promise<{
  delivered: boolean;
  reason?: string;
}> {
  return deliverSecurityAlert('security.test', correlationId);
}

async function deliverSecurityAlert(event: string, correlationId: string | null): Promise<{
  delivered: boolean;
  reason?: string;
}> {
  const decision = decideSecurityAlert(config.securityAlertWebhookUrl);
  if (!decision.deliver) return { delivered: false, reason: decision.reason };
  const body = event === 'security.test'
    ? securityTestAlertBody(correlationId ?? '')
    : { event, correlation_id: correlationId };
  try {
    const response = await fetch(decision.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await writeAudit({
        organizationId: null,
        actorUserId: null,
        entityType: 'security',
        action: 'security.alert_delivery_failed',
        payload: { event, http_status: response.status, correlation_id: correlationId },
      });
      return { delivered: false, reason: 'delivery_failed' };
    }
  } catch {
    await writeAudit({
      organizationId: null,
      actorUserId: null,
      entityType: 'security',
      action: 'security.alert_delivery_failed',
      payload: { event, correlation_id: correlationId },
    });
    return { delivered: false, reason: 'delivery_failed' };
  }
  return { delivered: true };
}
