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
import { readSecurityContainmentEnabled, releaseSecurityContainment } from '../../shared/security-containment.service.js';
import { edgeProtectionAggregate } from '../../shared/edge-protection.pure.js';
import { documentScanAggregate } from '../../shared/document-malware-scan.service.js';
import { createHash } from 'node:crypto';
import { groupSecurityJournalRows } from '../../shared/failed-login-policy.pure.js';

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
  'rule_id',
  'count_in_window',
  'threshold',
  'path_kind',
  'has_authorization',
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

export type SecurityJournalQuery = {
  from?: string | null;
  to?: string | null;
  severity?: string | null;
  event?: string | null;
  ip?: string | null;
  identifier?: string | null;
  page?: number | null;
};

export async function buildOwnerSecurityEventsAggregate(
  ctx: RequestContext,
  accessToken?: string,
  query: SecurityJournalQuery = {},
) {
  assertPlatformOwner(ctx);
  const since = query.from?.trim() || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const until = query.to?.trim() || null;
  const page = Number(query.page ?? 1);
  let journalQuery = supabaseAdmin
    .from('security_journal_entries')
    .select('id,created_at,action,severity,display_ip,country,city,attempted_identifier,attempted_identifier_hash,attempt_count,detection_reason,incident_id,cooldown_status,containment_action,alert_status,group_key')
    .is('hidden_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500);
  if (until) journalQuery = journalQuery.lte('created_at', until);
  if (query.severity && query.severity !== 'all') journalQuery = journalQuery.eq('severity', query.severity);
  if (query.event && query.event !== 'all') journalQuery = journalQuery.eq('action', query.event);
  if (query.ip?.trim()) journalQuery = journalQuery.eq('display_ip', query.ip.trim());
  if (query.identifier?.trim()) {
    journalQuery = journalQuery.eq(
      'attempted_identifier_hash',
      createHash('sha256').update(query.identifier.trim().toLowerCase()).digest('hex'),
    );
  }

  const [{ data, error }, incidentsRead, containmentRead, journalRead] = await Promise.all([
    supabaseAdmin
      .from('audit_log')
      .select('id, action, created_at, organization_id, actor_user_id, payload_json')
      .gte('created_at', since)
      .like('action', 'security.%')
      .order('created_at', { ascending: false })
      .limit(50),
    supabaseAdmin
      .from('security_incidents')
      .select('id,event_type,severity,confidence,status,rule_id,evidence_summary,evidence_json,source_ip,actor_user_id,organization_id,correlation_id,containment_action,containment_status,created_at,released_at')
      .order('created_at', { ascending: false })
      .limit(50),
    supabaseAdmin
      .from('security_containment_rules')
      .select('id,incident_id,scope,action,status,reason,starts_at,expires_at,released_at')
      .order('created_at', { ascending: false })
      .limit(50),
    journalQuery,
  ]);
  if (error) throw new AppError(500, 'Security events are unavailable', 'SECURITY_EVENTS_UNAVAILABLE');
  const phase5Unavailable = (err: { code?: string; message?: string } | null | undefined) =>
    Boolean(err && (err.code === '42P01' || err.code === 'PGRST205' || /security_incidents|security_containment_rules|schema cache/i.test(err.message ?? '')));
  if (incidentsRead.error && !phase5Unavailable(incidentsRead.error)) {
    throw new AppError(500, 'Security incidents are unavailable', 'SECURITY_INCIDENTS_UNAVAILABLE');
  }
  if (containmentRead.error && !phase5Unavailable(containmentRead.error)) {
    throw new AppError(500, 'Security containment is unavailable', 'SECURITY_CONTAINMENT_UNAVAILABLE');
  }
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
  const containmentByIncident = new Map<string, Array<Record<string, unknown>>>();
  for (const row of (containmentRead.data ?? []) as Array<Record<string, unknown>>) {
    const incidentId = String(row.incident_id ?? '');
    if (!incidentId) continue;
    const list = containmentByIncident.get(incidentId) ?? [];
    list.push({
      id: String(row.id),
      scope: String(row.scope),
      action: String(row.action),
      status: String(row.status),
      reason: String(row.reason),
      starts_at: String(row.starts_at),
      expires_at: String(row.expires_at),
      released_at: row.released_at ? String(row.released_at) : null,
    });
    containmentByIncident.set(incidentId, list);
  }
  const incidents = ((incidentsRead.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    event_type: String(row.event_type),
    severity: String(row.severity),
    confidence: String(row.confidence),
    status: String(row.status),
    rule_id: String(row.rule_id),
    evidence_summary: String(row.evidence_summary),
    evidence: safePayload(row.evidence_json),
    source_ip: row.source_ip ? String(row.source_ip) : null,
    actor_user_id: row.actor_user_id ? String(row.actor_user_id) : null,
    organization_id: row.organization_id ? String(row.organization_id) : null,
    correlation_id: row.correlation_id ? String(row.correlation_id) : null,
    containment_action: String(row.containment_action),
    containment_status: String(row.containment_status),
    created_at: String(row.created_at),
    released_at: row.released_at ? String(row.released_at) : null,
    containment_rules: containmentByIncident.get(String(row.id)) ?? [],
    allowed_actions: String(row.containment_status) === 'active' || String(row.status) === 'active'
      ? [{ action_key: 'release_security_containment', label: 'Release / unblock' }]
      : [],
  }));
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
    phase5_status: incidentsRead.error || containmentRead.error ? 'migration_required' as const : 'ready' as const,
    containment_enforcement: readSecurityContainmentEnabled() ? 'enabled' as const : 'disabled' as const,
    edge_protection: edgeProtectionAggregate({
      cloudflareOriginProtection: config.cloudflareOriginProtection,
      originPullConfigured: Boolean(config.cloudflareOriginPullSecret),
      verifiedByOwner: config.edgeProtectionVerified,
      coversWeb: true,
      coversApi: true,
    }),
    upload_scanning: documentScanAggregate(),
    distributed_rate_limit: { status: 'enabled' as const },
    active_incidents: incidents.filter((incident) => incident.status === 'active'),
    incident_history: incidents,
    events,
    journal: journalRead.error
      ? { groups: [], total_groups: 0, page: 1, page_size: 20, filter_options: { severities: ['critical', 'high', 'medium', 'low'], events: [] } }
      : {
          ...groupSecurityJournalRows(
            ((journalRead.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
              id: String(row.id),
              created_at: String(row.created_at),
              action: String(row.action),
              severity: String(row.severity),
              display_ip: String(row.display_ip),
              country: String(row.country ?? 'Unknown'),
              city: String(row.city ?? 'Unknown'),
              attempted_identifier: row.attempted_identifier ? String(row.attempted_identifier) : null,
              attempted_identifier_hash: row.attempted_identifier_hash ? String(row.attempted_identifier_hash) : null,
              attempt_count: Number(row.attempt_count ?? 1),
              detection_reason: String(row.detection_reason ?? ''),
              incident_id: row.incident_id ? String(row.incident_id) : null,
              cooldown_status: String(row.cooldown_status ?? 'none'),
              containment_action: String(row.containment_action ?? 'none'),
              alert_status: String(row.alert_status ?? 'not_required'),
              group_key: String(row.group_key),
            })),
            page,
            20,
          ),
          filter_options: {
            severities: ['critical', 'high', 'medium', 'low'],
            events: [...new Set(((journalRead.data ?? []) as Array<{ action?: string }>).map((row) => String(row.action ?? '')).filter(Boolean))],
          },
        },
    allowed_actions: [{ action_key: 'clear_security_journal', label: 'Clear journal view' }],
    permanent_mfa: permanentMfa,
  };
}

export async function clearOwnerSecurityJournal(ctx: RequestContext, accessToken?: string, query: SecurityJournalQuery = {}) {
  assertPlatformOwner(ctx);
  const now = new Date().toISOString();
  const update = await supabaseAdmin
    .from('security_journal_entries')
    .update({ hidden_at: now, hidden_by_user_id: ctx.user.id })
    .is('hidden_at', null);
  if (update.error && update.error.code !== '42P01' && update.error.code !== 'PGRST205') {
    throw new AppError(500, 'Security journal could not be cleared', 'SECURITY_JOURNAL_UNAVAILABLE');
  }
  await writeAudit({
    organizationId: null,
    actorUserId: ctx.user.id,
    entityType: 'security_journal',
    action: 'security.journal_cleared',
    payload: { mode: 'hide_view', retained: true },
  });
  return buildOwnerSecurityEventsAggregate(ctx, accessToken, query);
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

export async function releaseOwnerSecurityContainment(
  ctx: RequestContext,
  incidentId: string,
  reason: string | null | undefined,
  accessToken?: string,
) {
  assertPlatformOwner(ctx);
  const id = String(incidentId ?? '').trim();
  if (!id) throw new AppError(400, 'incident_id is required', 'BAD_REQUEST');
  await releaseSecurityContainment({ incidentId: id, actorUserId: ctx.user.id, reason: reason ?? null });
  return buildOwnerSecurityEventsAggregate(ctx, accessToken);
}
