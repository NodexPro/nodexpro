import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { supabaseAdmin } from '../db/client.js';
import { createEmailDeliveryAdapter } from './email-delivery.adapter.js';
import { getOwnerEmailProviderConfigGlobal } from './owner-email-provider-config.service.js';
import { safeSecurityPayload } from './security-event.pure.js';

type Severity = 'critical' | 'high' | 'medium' | 'low';
type DeliveryStatus = 'pending' | 'processing' | 'accepted' | 'failed';

type DeliveryRow = {
  id: string;
  event_action: string;
  severity: Severity;
  event_kind: 'security' | 'test';
  safe_context: Record<string, unknown> | null;
  correlation_id: string | null;
  status: DeliveryStatus;
  attempt_count: number;
  max_attempts: number;
  created_at?: string;
  updated_at?: string;
  accepted_at?: string | null;
  failure_code?: string | null;
};

export type SecurityAlertDeliverySummary = {
  channel: 'email';
  configured: boolean;
  destination_status: 'verified' | 'not_configured' | 'unverified';
  destination_masked: string | null;
  provider_status: 'configured' | 'not_configured';
  pending_count: number;
  accepted_count: number;
  failed_count: number;
  recent: Array<{
    id: string;
    event_action: string;
    severity: Severity;
    event_kind: 'security' | 'test';
    status: DeliveryStatus;
    attempt_count: number;
    failure_code: string | null;
    created_at: string | null;
    accepted_at: string | null;
  }>;
};

function normalizeEmail(value: string | null | undefined): string | null {
  const email = String(value ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

function retryDelayMs(attempt: number): number {
  return Math.min(30 * 60 * 1000, 60_000 * 2 ** Math.max(0, attempt - 1));
}

function safeFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/destination_unverified/.test(message)) return 'OWNER_DESTINATION_UNVERIFIED';
  if (/email_provider_not_configured/.test(message)) return 'EMAIL_PROVIDER_NOT_CONFIGURED';
  if (/email_send_failed/.test(message)) return 'EMAIL_PROVIDER_REJECTED';
  return 'EMAIL_DELIVERY_FAILED';
}

function isMissingQueueRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(
    error &&
      (error.code === '42P01' || error.code === 'PGRST205' || /relation|schema cache/i.test(error.message ?? '')),
  );
}

async function resolveVerifiedOwnerDestination(): Promise<{ email: string; masked: string }> {
  const expected = normalizeEmail(config.platformOwner.email);
  if (!expected) throw new Error('owner_destination_unverified');
  const { data: appUser, error: appUserError } = await supabaseAdmin
    .from('users')
    .select('auth_user_id, email')
    .eq('email', expected)
    .maybeSingle();
  if (appUserError || !appUser?.auth_user_id) throw new Error('owner_destination_unverified');
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(appUser.auth_user_id);
  const verified = normalizeEmail(data.user?.email);
  if (error || !data.user?.email_confirmed_at || verified !== expected) {
    throw new Error('owner_destination_unverified');
  }
  return { email: expected, masked: maskEmail(expected) };
}

function emailBody(row: DeliveryRow): { subject: string; text: string; html: string } {
  const test = row.event_kind === 'test';
  const title = test ? 'NodexPro security alert test' : `NodexPro ${row.severity} security alert`;
  const context = safeSecurityPayload(row.safe_context ?? {});
  const correlation = typeof context.correlation_id === 'string' ? context.correlation_id : row.correlation_id;
  const sourceIp = typeof context.source_ip === 'string' ? context.source_ip : null;
  const country = typeof context.country === 'string' ? context.country : null;
  const city = typeof context.city === 'string' ? context.city : null;
  const lines = [
    test ? 'This is a user-requested test alert. It is not a security incident.' : 'A confirmed NodexPro security event was recorded.',
    `Event: ${row.event_action}`,
    `Severity: ${row.severity}`,
    `Alert ID: ${row.id}`,
    ...(correlation ? [`Correlation ID: ${correlation}`] : []),
    ...(sourceIp ? [`Source IP: ${sourceIp}`] : []),
    ...(country || city ? [`Approximate location: ${country ?? 'Unknown'}, ${city ?? 'Unknown'}`] : []),
  ];
  const text = lines.join('\n');
  return {
    subject: title,
    text,
    html: `<p>${lines.map((line) => line.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br>')}</p>`,
  };
}

export async function enqueueSecurityAlert(input: {
  eventAction: string;
  severity: Severity;
  eventKind: 'security' | 'test';
  dedupeKey: string;
  correlationId?: string | null;
  safeContext?: Record<string, unknown> | null;
}): Promise<{ id: string | null; queued: boolean }> {
  const dedupeKey = createHash('sha256').update(input.dedupeKey).digest('hex');
  const inserted = await supabaseAdmin
    .from('security_alert_deliveries')
    .insert({
      dedupe_key: dedupeKey,
      event_action: input.eventAction,
      severity: input.severity,
      event_kind: input.eventKind,
      safe_context: safeSecurityPayload(input.safeContext ?? {}),
      correlation_id: input.correlationId ?? null,
    })
    .select('id')
    .maybeSingle();
  if (inserted.error) {
    if (inserted.error.code === '23505') return { id: null, queued: false };
    throw inserted.error;
  }
  return { id: inserted.data?.id ? String(inserted.data.id) : null, queued: true };
}

async function processRow(row: DeliveryRow): Promise<{ status: 'accepted' | 'failed'; code: string | null }> {
  try {
    const [provider, destination] = await Promise.all([
      getOwnerEmailProviderConfigGlobal(),
      resolveVerifiedOwnerDestination(),
    ]);
    if (!provider?.isConfigured) throw new Error('email_provider_not_configured');
    const body = emailBody(row);
    const sent = await createEmailDeliveryAdapter(provider).sendEmail({
      to: destination.email,
      subject: body.subject,
      text: body.text,
      html: body.html,
    });
    const { error } = await supabaseAdmin
      .from('security_alert_deliveries')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        provider_message_id: sent.providerMessageId,
        failure_code: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('status', 'processing');
    if (error) throw error;
    return { status: 'accepted', code: null };
  } catch (error) {
    const code = safeFailureCode(error);
    const exhausted = row.attempt_count >= row.max_attempts;
    await supabaseAdmin
      .from('security_alert_deliveries')
      .update({
        status: exhausted ? 'failed' : 'pending',
        failure_code: code,
        next_attempt_at: new Date(Date.now() + retryDelayMs(row.attempt_count)).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('status', 'processing');
    return { status: 'failed', code: exhausted ? code : null };
  }
}

export async function processSecurityAlertDeliveries(limit = 20): Promise<{ accepted: number; failed: number }> {
  const { data, error } = await supabaseAdmin.rpc('claim_security_alert_deliveries', { p_limit: limit });
  if (error) throw error;
  let accepted = 0;
  let failed = 0;
  for (const row of (data ?? []) as DeliveryRow[]) {
    const result = await processRow(row);
    if (result.status === 'accepted') accepted += 1;
    else failed += 1;
  }
  return { accepted, failed };
}

export async function sendQueuedSecurityTestAlert(input: {
  correlationId: string;
  actorUserId: string;
}): Promise<{ queued: boolean; status: 'accepted' | 'failed' | 'pending'; reason?: string }> {
  let queued: { id: string | null; queued: boolean };
  try {
    queued = await enqueueSecurityAlert({
      eventAction: 'security.test_alert',
      severity: 'low',
      eventKind: 'test',
      dedupeKey: `security-test:${input.actorUserId}:${input.correlationId}`,
      correlationId: input.correlationId,
      safeContext: { kind: 'test', correlation_id: input.correlationId },
    });
  } catch (error) {
    if (isMissingQueueRelation(error as { code?: string; message?: string })) {
      return { queued: false, status: 'failed', reason: 'ALERT_QUEUE_NOT_READY' };
    }
    throw error;
  }
  if (!queued.id) return { queued: false, status: 'pending', reason: 'duplicate_submission' };
  const claimed = await supabaseAdmin.rpc('claim_security_alert_delivery_by_id', { p_id: queued.id });
  if (isMissingQueueRelation(claimed.error)) {
    return { queued: true, status: 'failed', reason: 'ALERT_QUEUE_NOT_READY' };
  }
  if (claimed.error) throw claimed.error;
  const row = (claimed.data ?? [])[0] as DeliveryRow | undefined;
  if (!row) return { queued: true, status: 'pending' };
  const result = await processRow(row);
  return { queued: true, status: result.status, ...(result.code ? { reason: result.code } : {}) };
}

export async function getSecurityAlertDeliverySummary(): Promise<SecurityAlertDeliverySummary> {
  const provider = await getOwnerEmailProviderConfigGlobal();
  let destination: { email: string; masked: string } | null = null;
  try {
    destination = await resolveVerifiedOwnerDestination();
  } catch {
    destination = null;
  }
  const { data, error } = await supabaseAdmin
    .from('security_alert_deliveries')
    .select('id,event_action,severity,event_kind,status,attempt_count,failure_code,created_at,accepted_at')
    .order('created_at', { ascending: false })
    .limit(25);
  if (error && !isMissingQueueRelation(error)) throw error;
  const rows = (data ?? []) as DeliveryRow[];
  return {
    channel: 'email',
    configured: Boolean(provider?.isConfigured && destination),
    destination_status: destination ? 'verified' : config.platformOwner.email ? 'unverified' : 'not_configured',
    destination_masked: destination?.masked ?? null,
    provider_status: provider?.isConfigured ? 'configured' : 'not_configured',
    pending_count: rows.filter((row) => row.status === 'pending' || row.status === 'processing').length,
    accepted_count: rows.filter((row) => row.status === 'accepted').length,
    failed_count: rows.filter((row) => row.status === 'failed').length,
    recent: rows.map((row) => ({
      id: row.id,
      event_action: row.event_action,
      severity: row.severity,
      event_kind: row.event_kind,
      status: row.status,
      attempt_count: row.attempt_count,
      failure_code: row.failure_code ?? null,
      created_at: row.created_at ?? null,
      accepted_at: row.accepted_at ?? null,
    })),
  };
}
