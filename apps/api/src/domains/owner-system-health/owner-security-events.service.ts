import { config } from '../../config.js';
import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { writeAudit } from '../../shared/audit-events.js';
import { AppError } from '../../shared/errors.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { getSecurityAlertDeliverySummary, sendQueuedSecurityTestAlert } from '../../shared/security-alert-delivery.service.js';
import { securityAlertSeverity } from '../../shared/security-alert-policy.pure.js';
import { DBIP_ATTRIBUTION_TEXT, DBIP_ATTRIBUTION_URL } from '../../shared/geoip-dbip.service.js';
import { buildPermanentMfaPanel } from '../auth/privileged-mfa.service.js';

const SAFE_PAYLOAD_KEYS = new Set([
  'http_status',
  'code',
  'kind',
  'failure_count',
  'signal',
  'repeated',
  'correlation_id',
  'source_ip',
  'country',
  'country_code',
  'city',
  'region',
  'asn',
  'network',
  'risk',
  'provider',
  'looked_up_at',
  'accuracy_note',
]);

export function securityEventSeverity(action: string): 'critical' | 'high' | 'medium' | 'low' {
  return securityAlertSeverity(action);
}

function safePayload(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!SAFE_PAYLOAD_KEYS.has(key)) continue;
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null) out[key] = item;
  }
  return out;
}

export async function buildOwnerSecurityEventsAggregate(ctx: RequestContext, accessToken?: string) {
  assertPlatformOwner(ctx);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('audit_log')
    .select('id, action, created_at, organization_id, actor_user_id, payload_json')
    .gte('created_at', since)
    .like('action', 'security.%')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new AppError(500, 'Security events are unavailable', 'SECURITY_EVENTS_UNAVAILABLE');
  const events = (data ?? []).map((row) => ({
    id: String(row.id),
    action: String(row.action),
    severity: securityEventSeverity(String(row.action)),
    created_at: String(row.created_at),
    organization_id: row.organization_id ? String(row.organization_id) : null,
    actor_user_id: row.actor_user_id ? String(row.actor_user_id) : null,
    payload: safePayload(row.payload_json),
  }));
  const permanentMfa = accessToken ? await buildPermanentMfaPanel(ctx, accessToken) : null;
  const delivery = await getSecurityAlertDeliverySummary();
  return {
    aggregate_key: 'owner_security_events' as const,
    window_hours: 24,
    alert_delivery: delivery.configured || config.securityAlertWebhookUrl ? ('configured' as const) : ('not_configured' as const),
    alert_delivery_channel: delivery,
    geoip_attribution: {
      text: DBIP_ATTRIBUTION_TEXT,
      url: DBIP_ATTRIBUTION_URL,
    },
    delivery_failure_count: events.filter((event) => event.action === 'security.alert_delivery_failed').length,
    events,
    permanent_mfa: permanentMfa,
  };
}

export async function deliverOwnerSecurityTestAlert(ctx: RequestContext, correlationId: string, accessToken?: string) {
  assertPlatformOwner(ctx);
  await writeAudit({
    organizationId: null,
    actorUserId: ctx.user.id,
    entityType: 'security',
    action: 'security.test_alert',
    payload: { kind: 'test', correlation_id: correlationId },
  });
  const testDelivery = await sendQueuedSecurityTestAlert({
    correlationId,
    actorUserId: ctx.user.id,
  });
  const aggregate = await buildOwnerSecurityEventsAggregate(ctx, accessToken);
  return { ...aggregate, test_delivery: testDelivery };
}
