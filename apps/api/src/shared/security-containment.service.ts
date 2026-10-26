import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from '../db/client.js';
import { forbidden } from './errors.js';
import { writeAudit } from './audit-events.js';
import { safeSecurityPayload } from './security-event.pure.js';
import {
  decideAutomaticContainment,
  isSecurityContainmentEnabled,
  ruleForSecurityAction,
  shouldCreateIncident,
  shouldEnforceRecordedContainment,
  type SecurityRuleDecision,
} from './security-phase5.pure.js';
import { isPrivateOrReservedIp, resolveTrustedSourceIp } from './request-source.pure.js';
import { config } from '../config.js';
import { revokeCompromisedUserSessions } from './session-revocation.service.js';

export const SECURITY_RESTRICTED_MESSAGE = 'Suspicious activity has been detected. Your session has been restricted.';

export function readSecurityContainmentEnabled(): boolean {
  return isSecurityContainmentEnabled(process.env.SECURITY_CONTAINMENT_ENABLED);
}

function isPlatformOwnerActor(actorUserId: string | null | undefined, actorEmail?: string | null): boolean {
  const ownerEmail = config.platformOwner.email?.trim().toLowerCase() ?? '';
  if (!ownerEmail) return false;
  const email = String(actorEmail ?? '').trim().toLowerCase();
  return Boolean(email && email === ownerEmail);
}

function isMissingSecurityPhase5(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(
    error &&
      (error.code === '42P01' ||
        error.code === '42883' ||
        error.code === 'PGRST202' ||
        error.code === 'PGRST205' ||
        /security_detection_buckets|security_incidents|security_containment_rules|schema cache|function/i.test(error.message ?? '')),
  );
}

function subjectFor(input: {
  decision: SecurityRuleDecision;
  sourceIp: string | null;
  actorUserId: string | null;
  sessionFingerprint: string | null;
}): string | null {
  if (input.decision.containment_scope === 'source_ip') return input.sourceIp;
  if (input.decision.containment_scope === 'user') return input.actorUserId;
  if (input.decision.containment_scope === 'session') return input.sessionFingerprint;
  return null;
}

function containmentSubjectKey(subject: string): string {
  return createHash('sha256').update(`containment:${subject}`).digest('hex');
}

async function createIncidentAndContainment(input: {
  action: string;
  decision: SecurityRuleDecision;
  dedupeKey: string;
  countInWindow: number;
  sourceIp: string | null;
  actorUserId: string | null;
  organizationId: string | null;
  correlationId: string | null;
  safeContext: Record<string, unknown>;
  sessionFingerprint?: string | null;
  isPlatformOwnerActor: boolean;
}): Promise<{ incidentId: string | null; contained: boolean }> {
  const evidence = safeSecurityPayload({
    ...input.safeContext,
    triggering_action: input.action,
    rule_id: input.decision.rule_id,
    count_in_window: input.countInWindow,
    threshold: input.decision.threshold,
    correlation_id: input.correlationId,
  });
  const safety = decideAutomaticContainment({
    enabled: readSecurityContainmentEnabled(),
    action: input.decision.containment_action,
    scope: input.decision.containment_scope,
    sourceIp: input.sourceIp,
    actorUserId: input.actorUserId,
    isPlatformOwnerActor: input.isPlatformOwnerActor,
    isPrivateOrReservedSource: isPrivateOrReservedIp(input.sourceIp),
  });
  const incident = await supabaseAdmin
    .from('security_incidents')
    .insert({
      dedupe_key: input.dedupeKey,
      event_type: input.decision.event_type,
      severity: input.decision.severity,
      confidence: input.decision.confidence,
      status: 'active',
      rule_id: input.decision.rule_id,
      evidence_summary: input.decision.evidence_summary,
      evidence_json: evidence,
      source_ip: input.sourceIp,
      actor_user_id: input.actorUserId,
      organization_id: input.organizationId,
      session_fingerprint: input.sessionFingerprint ?? null,
      correlation_id: input.correlationId,
      containment_action: input.decision.containment_action,
      containment_status: safety.apply ? 'active' : 'owner_review',
    })
    .select('id')
    .maybeSingle();
  if (incident.error) {
    if (incident.error.code === '23505') {
      const existing = await supabaseAdmin
        .from('security_incidents')
        .select('id')
        .eq('dedupe_key', input.dedupeKey)
        .maybeSingle();
      return { incidentId: existing.data?.id ? String(existing.data.id) : null, contained: false };
    }
    throw incident.error;
  }
  const incidentId = incident.data?.id ? String(incident.data.id) : null;
  const subject = subjectFor({
    decision: input.decision,
    sourceIp: input.sourceIp,
    actorUserId: input.actorUserId,
    sessionFingerprint: input.sessionFingerprint ?? null,
  });
  if (!incidentId || !safety.apply || !subject || !input.decision.containment_scope) {
    return { incidentId, contained: false };
  }
  const expiresAt = new Date(Date.now() + input.decision.containment_ttl_seconds * 1000).toISOString();
  const containment = await supabaseAdmin
    .from('security_containment_rules')
    .insert({
      incident_id: incidentId,
      scope: input.decision.containment_scope,
      subject_hash: containmentSubjectKey(subject),
      action: input.decision.containment_action,
      status: 'active',
      reason: input.decision.evidence_summary,
      starts_at: new Date().toISOString(),
      expires_at: expiresAt,
    });
  if (containment.error && containment.error.code !== '23505') throw containment.error;
  if (!containment.error && input.actorUserId && input.decision.containment_scope === 'user') {
    await revokeCompromisedUserSessions({
      actorUserId: input.actorUserId,
      incidentId,
      reason: input.decision.rule_id,
    }).catch(() => undefined);
  }
  return { incidentId, contained: !containment.error };
}

export async function handleSecurityDetection(input: {
  action: string;
  dedupeKey: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  organizationId?: string | null;
  correlationId?: string | null;
  sourceIp?: string | null;
  safeContext?: Record<string, unknown> | null;
  sessionFingerprint?: string | null;
  incidentReady?: boolean;
}): Promise<{ incidentId: string | null; contained: boolean; countInWindow: number | null }> {
  const decision = ruleForSecurityAction(input.action);
  if (!decision) return { incidentId: null, contained: false, countInWindow: null };
  try {
    const bucket = await supabaseAdmin.rpc('record_security_detection_bucket', {
      p_bucket_key: input.dedupeKey,
      p_window_seconds: decision.window_seconds,
    });
    if (bucket.error) {
      if (isMissingSecurityPhase5(bucket.error)) return { incidentId: null, contained: false, countInWindow: null };
      throw bucket.error;
    }
    const row = (Array.isArray(bucket.data) ? bucket.data[0] : bucket.data) as { request_count?: number } | null;
    const countInWindow = Math.max(1, Number(row?.request_count ?? 1));
    if (!input.incidentReady && !shouldCreateIncident(countInWindow, decision)) {
      return { incidentId: null, contained: false, countInWindow };
    }
    const result = await createIncidentAndContainment({
      action: input.action,
      decision,
      dedupeKey: `${decision.rule_id}:${input.dedupeKey}`,
      countInWindow,
      sourceIp: resolveTrustedSourceIp({ reqIp: input.sourceIp }),
      actorUserId: input.actorUserId ?? null,
      organizationId: input.organizationId ?? null,
      correlationId: input.correlationId ?? null,
      safeContext: input.safeContext ?? {},
      sessionFingerprint: input.sessionFingerprint ?? null,
      isPlatformOwnerActor: isPlatformOwnerActor(input.actorUserId ?? null, input.actorEmail ?? null),
    });
    return { ...result, countInWindow };
  } catch (error) {
    if (!isMissingSecurityPhase5(error as { code?: string; message?: string })) {
      await writeAudit({
        organizationId: null,
        actorUserId: null,
        entityType: 'security',
        action: 'security.containment_engine_failed',
        payload: { code: error instanceof Error ? error.message.slice(0, 60) : 'unknown' },
      }).catch(() => undefined);
    }
    return { incidentId: null, contained: false, countInWindow: null };
  }
}

async function activeContainment(input: {
  scope: 'source_ip' | 'user' | 'session';
  subject: string | null;
  action?: string | null;
}): Promise<{ id: string; action: string; expires_at: string } | null> {
  if (!input.subject) return null;
  const { data, error } = await supabaseAdmin
    .from('security_containment_rules')
    .select('id, action, expires_at')
    .eq('scope', input.scope)
    .eq('subject_hash', containmentSubjectKey(input.subject))
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingSecurityPhase5(error)) return null;
    throw error;
  }
  const row = data as { id?: string; action?: string; expires_at?: string } | null;
  if (!row?.id) return null;
  if (input.action && row.action !== input.action) return null;
  return { id: String(row.id), action: String(row.action), expires_at: String(row.expires_at) };
}

export async function assertRequestNotContained(input: {
  sourceIp?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  sessionFingerprint?: string | null;
  sensitiveCommand?: boolean;
  path?: string | null;
}): Promise<void> {
  const ownerActor = isPlatformOwnerActor(input.actorUserId ?? null, input.actorEmail ?? null);
  const source = resolveTrustedSourceIp({ reqIp: input.sourceIp });
  if (
    !shouldEnforceRecordedContainment({
      enabled: readSecurityContainmentEnabled(),
      path: input.path,
      scope: 'user',
      isPlatformOwnerActor: ownerActor,
      isPrivateOrReservedSource: isPrivateOrReservedIp(source),
    })
  ) {
    return;
  }
  if (input.sensitiveCommand) {
    const userRule = await activeContainment({
      scope: 'user',
      subject: input.actorUserId ?? null,
      action: 'restrict_user_sensitive_commands',
    });
    if (userRule) throw forbidden(SECURITY_RESTRICTED_MESSAGE, 'SECURITY_RESTRICTED');
  }
}

export function securityContainmentMiddleware() {
  return async (_req: Request, _res: Response, next: NextFunction) => {
    // Source-IP rules are never enforced: shared NAT, office, VPN and Owner lockout.
    // Authenticated user restrictions are applied after auth, and only when the kill switch is on.
    next();
  };
}

export async function releaseSecurityContainment(input: {
  incidentId: string;
  actorUserId: string;
  reason?: string | null;
}): Promise<{ released: boolean }> {
  const now = new Date().toISOString();
  const [{ error: containmentError }, { error: incidentError }] = await Promise.all([
    supabaseAdmin
      .from('security_containment_rules')
      .update({ status: 'released', released_at: now, released_by_user_id: input.actorUserId })
      .eq('incident_id', input.incidentId)
      .eq('status', 'active'),
    supabaseAdmin
      .from('security_incidents')
      .update({ status: 'released', containment_status: 'released', released_at: now, released_by_user_id: input.actorUserId })
      .eq('id', input.incidentId),
  ]);
  if (containmentError) throw containmentError;
  if (incidentError) throw incidentError;
  await writeAudit({
    organizationId: null,
    actorUserId: input.actorUserId,
    entityType: 'security_incident',
    entityId: input.incidentId,
    action: 'security.containment_released',
    payload: safeSecurityPayload({ reason: input.reason ?? null }),
  });
  return { released: true };
}

