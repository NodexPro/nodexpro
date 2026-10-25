import { config } from '../../config.js';
import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AppError } from '../../shared/errors.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { deliverSecurityTestAlert } from '../../shared/security-event.service.js';
import { buildPermanentMfaPanel } from '../auth/privileged-mfa.service.js';

const SAFE_PAYLOAD_KEYS = new Set(['http_status', 'code', 'kind', 'failure_count', 'signal', 'repeated', 'correlation_id']);

export function securityEventSeverity(action: string): 'critical' | 'high' | 'medium' | 'low' {
  if (action === 'security.alert_delivery_failed' || action === 'security.privileged_mfa_failed') return 'critical';
  if (action === 'security.platform_owner_mfa_activated') return 'critical';
  if (action === 'security.suspicious_sign_in' || action === 'security.suspicious_repeated') return 'high';
  if (action === 'security.forbidden' || action === 'security.unauthorized' || action === 'security.sensitive_access') return 'medium';
  return 'low';
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
  return {
    aggregate_key: 'owner_security_events' as const,
    window_hours: 24,
    alert_delivery: config.securityAlertWebhookUrl ? ('configured' as const) : ('not_configured' as const),
    delivery_failure_count: events.filter((event) => event.action === 'security.alert_delivery_failed').length,
    events,
    permanent_mfa: permanentMfa,
  };
}

export async function deliverOwnerSecurityTestAlert(ctx: RequestContext, correlationId: string, accessToken?: string) {
  assertPlatformOwner(ctx);
  const testDelivery = await deliverSecurityTestAlert(correlationId);
  const aggregate = await buildOwnerSecurityEventsAggregate(ctx, accessToken);
  return { ...aggregate, test_delivery: testDelivery };
}
