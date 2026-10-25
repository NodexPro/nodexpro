import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { config } from '../../config.js';
import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { writeAudit } from '../../shared/audit-events.js';
import { AppError, badRequest } from '../../shared/errors.js';
import { getPrivilegedMfaGate, setPrivilegedMfaGate } from '../../shared/privileged-mfa-gate.js';
import {
  PRIVILEGED_MFA_GATE_REFRESH_MIN_INTERVAL_MS,
  decidePrivilegedMfaGateRefresh,
} from '../../shared/privileged-mfa-gate-refresh.pure.js';
import {
  decideRecoveryEnrollment,
  decideRecoveryGrantIssue,
  decideRecoveryGrantStatus,
  isMissingRelationError,
  isRecoveryDrillReady,
  permanentMfaPanelView,
  resolvePrivilegedMfaActivationState,
  type EnforcementObservation,
  type PresenceObservation,
  type PrivilegedMfaActivationState,
} from '../../shared/privileged-mfa-activation.pure.js';
import { isPlatformOwnerSession } from '../../shared/privileged-mfa.pure.js';
import { recordSecurityEvent } from '../../shared/security-event.service.js';
import {
  MFA_PROMPT_ACTION,
  MFA_PROMPT_WARNING_VERSION,
  mfaPolicyView,
  mfaPromptCopy,
  mfaPromptVisibility,
  mfaSecurityCopy,
  nextCommandsForMfaPrompt,
  parseMfaPromptDecision,
  type MfaPromptDecision,
} from './mfa-onboarding.pure.js';
import {
  generateRecoveryCode,
  generateRecoveryGrantSecret,
  grantSecretMatches,
  hashGrantSecret,
  hashRecoveryCode,
  recoveryCodeMatches,
} from './mfa-recovery.pure.js';
import { issueTrustedDevice, listTrustedDevices, revokeAllTrustedDevices, revokeTrustedDeviceForUser } from './mfa-trusted-device.service.js';

function userClient(accessToken: string) {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

function observePresence(error: { code?: string; message?: string } | null, present: boolean): PresenceObservation {
  if (error) return isMissingRelationError(error) ? 'absent' : 'unreadable';
  return present ? 'present' : 'absent';
}

export async function readPrivilegedMfaActivationState(): Promise<PrivilegedMfaActivationState> {
  const previous = getPrivilegedMfaGate().activationState;
  const [schema, enforcement, receipt, audit] = await Promise.all([
    supabaseAdmin.from('platform_owner_mfa_schema').select('id').eq('id', 'schema').maybeSingle(),
    supabaseAdmin.from('platform_owner_mfa_enforcement').select('state').eq('id', 'platform_owner').maybeSingle(),
    supabaseAdmin.from('platform_owner_mfa_activation_receipt').select('id').eq('id', 'platform_owner').maybeSingle(),
    supabaseAdmin.from('audit_log').select('id').eq('action', 'security.platform_owner_mfa_activated').limit(1).maybeSingle(),
  ]);

  let enforcementObservation: EnforcementObservation;
  if (enforcement.error) {
    enforcementObservation = isMissingRelationError(enforcement.error) ? 'absent' : 'unreadable';
  } else if (!enforcement.data) {
    enforcementObservation = 'absent';
  } else if (enforcement.data.state === 'PERMANENTLY_ACTIVE') {
    enforcementObservation = 'permanently_active';
  } else if (enforcement.data.state === 'NOT_ACTIVATED') {
    enforcementObservation = 'not_activated';
  } else {
    enforcementObservation = 'corrupt';
  }

  return resolvePrivilegedMfaActivationState({
    schema: observePresence(schema.error, Boolean(schema.data)),
    enforcement: enforcementObservation,
    receipt: observePresence(receipt.error, Boolean(receipt.data)),
    activationAudit: observePresence(audit.error, Boolean(audit.data)),
    previous,
  });
}

let privilegedMfaGateRefreshAt = 0;
let privilegedMfaGateRefreshInFlight: Promise<void> | null = null;

async function loadPrivilegedMfaGate(): Promise<void> {
  const previous = getPrivilegedMfaGate();
  try {
    const [recovery, trusted, activationState] = await Promise.all([
      supabaseAdmin.from('privileged_mfa_recovery_codes').select('id', { head: true }).limit(1),
      supabaseAdmin.from('mfa_trusted_devices').select('id', { head: true }).limit(1),
      readPrivilegedMfaActivationState(),
    ]);
    setPrivilegedMfaGate({
      recoveryReady: !recovery.error,
      trustedDevicesReady: !trusted.error,
      activationState,
    });
  } catch {
    setPrivilegedMfaGate({
      recoveryReady: previous.recoveryReady,
      trustedDevicesReady: previous.trustedDevicesReady,
      activationState: previous.activationState === 'permanently_active' ? 'permanently_active' : 'unreadable',
    });
  }
}

export async function refreshPrivilegedMfaGate(options?: { force?: boolean }): Promise<void> {
  const force = options?.force === true;
  const decision = decidePrivilegedMfaGateRefresh({
    force,
    activationState: getPrivilegedMfaGate().activationState,
    msSinceLastRefresh: Date.now() - privilegedMfaGateRefreshAt,
    minIntervalMs: PRIVILEGED_MFA_GATE_REFRESH_MIN_INTERVAL_MS,
    hasInFlight: privilegedMfaGateRefreshInFlight !== null,
  });
  if (decision === 'skip') return;
  if (decision === 'join-inflight' && privilegedMfaGateRefreshInFlight) {
    await privilegedMfaGateRefreshInFlight;
    if (!force) return;
  }
  const run = loadPrivilegedMfaGate();
  privilegedMfaGateRefreshInFlight = run;
  try {
    await run;
  } finally {
    if (privilegedMfaGateRefreshInFlight === run) privilegedMfaGateRefreshInFlight = null;
    privilegedMfaGateRefreshAt = Date.now();
  }
}

export function buildMfaStatusAggregate(ctx: RequestContext): {
  aggregate_key: 'mfa_status';
  authenticator_assurance: 'aal1' | 'aal2';
  enforcement: 'off' | 'enforce';
  recovery_ready: boolean;
  enrollment_available: true;
} {
  const gate = getPrivilegedMfaGate();
  const owner = isPlatformOwnerSession({
    userEmail: ctx.user.email,
    configuredOwnerEmail: config.platformOwner.email,
    tenantRoleCode: ctx.membership?.roleCode ?? null,
  });
  const enforce = owner && gate.activationState === 'permanently_active';
  return {
    aggregate_key: 'mfa_status',
    authenticator_assurance: ctx.authenticatorAssurance ?? 'aal1',
    enforcement: enforce ? 'enforce' : 'off',
    recovery_ready: gate.recoveryReady,
    enrollment_available: true,
  };
}

function isCurrentPlatformOwner(ctx: RequestContext): boolean {
  return isPlatformOwnerSession({
    userEmail: ctx.user.email,
    configuredOwnerEmail: config.platformOwner.email,
    tenantRoleCode: ctx.membership?.roleCode ?? null,
  });
}

async function consumeRecoveryEnrollmentGrant(userId: string, grantInput: unknown): Promise<'valid' | 'missing' | 'used' | 'expired' | 'unreadable'> {
  const secret = typeof grantInput === 'string' ? grantInput.trim() : '';
  if (!secret) return 'missing';
  const { data, error } = await supabaseAdmin
    .from('platform_owner_mfa_recovery_grants')
    .select('id, grant_hash, grant_salt, consumed_at, expires_at')
    .eq('user_id', userId)
    .eq('purpose', 'reenroll_totp')
    .is('consumed_at', null);
  if (error) return isMissingRelationError(error) ? 'missing' : 'unreadable';
  const now = new Date().toISOString();
  const match = (data ?? []).find((row) => {
    const salt = typeof row.grant_salt === 'string' ? row.grant_salt : '';
    const hash = typeof row.grant_hash === 'string' ? row.grant_hash : '';
    return salt && hash && grantSecretMatches(secret, salt, hash);
  });
  if (!match) return 'missing';
  const status = decideRecoveryGrantStatus({
    consumedAt: typeof match.consumed_at === 'string' ? match.consumed_at : null,
    expiresAt: String(match.expires_at),
    now,
  });
  if (status !== 'valid') return status;
  const consumed = await supabaseAdmin
    .from('platform_owner_mfa_recovery_grants')
    .update({ consumed_at: now })
    .eq('id', match.id)
    .is('consumed_at', null)
    .select('id');
  if (consumed.error || !consumed.data?.length) return consumed.error && !isMissingRelationError(consumed.error) ? 'unreadable' : 'used';
  return 'valid';
}

async function peekRecoveryEnrollmentGrant(userId: string, grantInput: unknown): Promise<'valid' | 'missing' | 'used' | 'expired' | 'unreadable'> {
  const secret = typeof grantInput === 'string' ? grantInput.trim() : '';
  if (!secret) return 'missing';
  const { data, error } = await supabaseAdmin
    .from('platform_owner_mfa_recovery_grants')
    .select('grant_hash, grant_salt, consumed_at, expires_at')
    .eq('user_id', userId)
    .eq('purpose', 'reenroll_totp');
  if (error) return isMissingRelationError(error) ? 'missing' : 'unreadable';
  const now = new Date().toISOString();
  const match = (data ?? []).find((row) => {
    const salt = typeof row.grant_salt === 'string' ? row.grant_salt : '';
    const hash = typeof row.grant_hash === 'string' ? row.grant_hash : '';
    return salt && hash && grantSecretMatches(secret, salt, hash);
  });
  if (!match) return 'missing';
  return decideRecoveryGrantStatus({
    consumedAt: typeof match.consumed_at === 'string' ? match.consumed_at : null,
    expiresAt: String(match.expires_at),
    now,
  });
}

async function requireRecoveryEnrollment(ctx: RequestContext, grantInput: unknown, consume: boolean): Promise<void> {
  await refreshPrivilegedMfaGate();
  const permanentlyActive = getPrivilegedMfaGate().activationState === 'permanently_active';
  const grant = consume
    ? await consumeRecoveryEnrollmentGrant(ctx.user.id, grantInput)
    : await peekRecoveryEnrollmentGrant(ctx.user.id, grantInput);
  const decision = decideRecoveryEnrollment({
    permanentlyActive,
    platformOwner: isCurrentPlatformOwner(ctx),
    assurance: ctx.authenticatorAssurance ?? 'aal1',
    grant,
  });
  if (decision === 'reject') {
    throw new AppError(401, 'נדרש אישור שחזור קצר־טווח לרישום מאמת', 'MFA_RECOVERY_GRANT_REQUIRED');
  }
}

async function issueRecoveryEnrollmentGrant(userId: string): Promise<string> {
  const secret = generateRecoveryGrantSecret();
  const hashed = hashGrantSecret(secret);
  const now = new Date().toISOString();
  const previous = await supabaseAdmin
    .from('platform_owner_mfa_recovery_grants')
    .select('id')
    .eq('user_id', userId)
    .eq('purpose', 'reenroll_totp')
    .is('consumed_at', null);
  if (previous.data?.length) {
    await supabaseAdmin
      .from('platform_owner_mfa_recovery_grants')
      .update({ consumed_at: now })
      .in('id', previous.data.map((row) => row.id));
  }
  const inserted = await supabaseAdmin.from('platform_owner_mfa_recovery_grants').insert({
    user_id: userId,
    purpose: 'reenroll_totp',
    grant_hash: hashed.hash,
    grant_salt: hashed.salt,
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  }).select('id');
  if (inserted.error || !inserted.data?.length) {
    throw new AppError(503, 'אישור השחזור לא הונפק', 'MFA_RECOVERY_GRANT_UNAVAILABLE');
  }
  return secret;
}

export async function enrollMfaFactor(ctx: RequestContext, accessToken: string, grantInput?: unknown): Promise<{
  aggregate_key: 'mfa_enrollment';
  factor_id: string;
  otpauth_uri: string;
  aggregate: Awaited<ReturnType<typeof buildMfaOnboardingAggregate>>;
}> {
  await requireRecoveryEnrollment(ctx, grantInput, false);
  const { data, error } = await userClient(accessToken).auth.mfa.enroll({
    factorType: 'totp',
    issuer: 'NodexPro',
    friendlyName: `NodexPro ${randomUUID()}`,
  });
  if (error || !data?.id || !data.totp?.uri) {
    throw new AppError(503, 'לא ניתן להתחיל את ההפעלה כרגע', 'MFA_ENROLLMENT_UNAVAILABLE');
  }
  return {
    aggregate_key: 'mfa_enrollment',
    factor_id: data.id,
    otpauth_uri: data.totp.uri,
    aggregate: await buildMfaOnboardingAggregate(ctx, accessToken),
  };
}

export async function verifyMfaFactor(ctx: RequestContext, accessToken: string, factorId: string, code: string, grantInput?: unknown): Promise<{
  aggregate_key: 'mfa_verification';
  authenticator_assurance: 'aal2';
  access_token: string;
  refresh_token: string;
  aggregate: Awaited<ReturnType<typeof buildMfaOnboardingAggregate>>;
}> {
  const factor = factorId.trim();
  const otp = code.trim();
  if (!factor || !/^\d{6}$/.test(otp)) throw badRequest('factor_id and a 6-digit code are required');
  await requireRecoveryEnrollment(ctx, grantInput, false);
  const client = userClient(accessToken);
  const challenge = await client.auth.mfa.challenge({ factorId: factor });
  if (challenge.error || !challenge.data?.id) {
    throw new AppError(401, 'MFA challenge failed', 'MFA_CHALLENGE_FAILED');
  }
  const verified = await client.auth.mfa.verify({
    factorId: factor,
    challengeId: challenge.data.id,
    code: otp,
  });
  const access = verified.data?.access_token;
  const refresh = verified.data?.refresh_token;
  if (verified.error || !access || !refresh) {
    throw new AppError(401, 'הקוד לא נכון. נסו שוב.', 'MFA_VERIFICATION_FAILED');
  }
  if (
    getPrivilegedMfaGate().activationState === 'permanently_active' &&
    isCurrentPlatformOwner(ctx) &&
    (ctx.authenticatorAssurance ?? 'aal1') !== 'aal2'
  ) {
    const consumed = await consumeRecoveryEnrollmentGrant(ctx.user.id, grantInput);
    if (consumed !== 'valid' && consumed !== 'used') {
      throw new AppError(401, 'נדרש אישור שחזור קצר־טווח לרישום מאמת', 'MFA_RECOVERY_GRANT_REQUIRED');
    }
  }
  return {
    aggregate_key: 'mfa_verification',
    authenticator_assurance: 'aal2',
    access_token: access,
    refresh_token: refresh,
    aggregate: await buildMfaOnboardingAggregate(ctx, access, 'aal2'),
  };
}

async function totpFactors(accessToken: string): Promise<{ verifiedIds: string[]; pendingIds: string[] }> {
  const listed = await userClient(accessToken).auth.mfa.listFactors();
  if (listed.error) throw new AppError(503, 'מצב האימות אינו זמין כרגע', 'MFA_STATUS_UNAVAILABLE');
  const all = listed.data?.all ?? [];
  return {
    verifiedIds: all.filter((factor) => factor.factor_type === 'totp' && factor.status === 'verified').map((factor) => factor.id),
    pendingIds: all.filter((factor) => factor.factor_type === 'totp' && factor.status === 'unverified').map((factor) => factor.id),
  };
}

async function recordedPromptVersion(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('audit_log')
    .select('payload_json')
    .eq('actor_user_id', userId)
    .eq('action', MFA_PROMPT_ACTION)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new AppError(503, 'MFA prompt state is not available', 'MFA_PROMPT_UNAVAILABLE');
  for (const row of data ?? []) {
    const payload = row.payload_json as { warning_version?: unknown; decision?: unknown } | null;
    if (payload?.warning_version === MFA_PROMPT_WARNING_VERSION && parseMfaPromptDecision(payload.decision)) {
      return MFA_PROMPT_WARNING_VERSION;
    }
  }
  return null;
}

export async function buildMfaOnboardingAggregate(ctx: RequestContext, accessToken: string, assurance?: 'aal1' | 'aal2') {
  const copy = mfaPromptCopy();
  const screen = mfaSecurityCopy();
  const gate = getPrivilegedMfaGate();
  const [factors, recorded, devices] = await Promise.all([
    totpFactors(accessToken),
    recordedPromptVersion(ctx.user.id),
    gate.trustedDevicesReady ? listTrustedDevices(ctx.user.id) : Promise.resolve([]),
  ]);
  const verified = factors.verifiedIds.length > 0;
  const show = mfaPromptVisibility({ verifiedFactor: verified, recordedWarningVersion: recorded });
  const policy = mfaPolicyView({
    platformOwner: isPlatformOwnerSession({
      userEmail: ctx.user.email,
      configuredOwnerEmail: config.platformOwner.email,
      tenantRoleCode: ctx.membership?.roleCode,
    }),
    activationState: gate.activationState,
    recoveryReady: gate.recoveryReady,
    trustedDevicesReady: gate.trustedDevicesReady,
  });
  const status = buildMfaStatusAggregate({ ...ctx, authenticatorAssurance: assurance ?? ctx.authenticatorAssurance });
  const thisDevice = !gate.trustedDevicesReady ? 'unavailable' : ctx.trustedDevice ? 'trusted' : 'untrusted';
  const deviceStatusHe = thisDevice === 'trusted'
    ? 'המכשיר הזה מהימן'
    : thisDevice === 'unavailable'
      ? screen.trusted_unavailable_he
      : 'המכשיר הזה אינו מהימן';
  return {
    ...status,
    verified_factor: verified,
    mfa_enabled: verified,
    pending_factor: factors.pendingIds.length > 0,
    this_device: thisDevice,
    policy,
    prompt: {
      show,
      warning_version: copy.warning_version,
      title_he: copy.title_he,
      body_he: copy.body_he,
      accept_command: 'acknowledge_mfa_prompt' as const,
      accept_decision: 'accept' as const,
      accept_label_he: copy.accept_label_he,
      decline_command: 'acknowledge_mfa_prompt' as const,
      decline_decision: 'decline' as const,
      decline_label_he: copy.decline_label_he,
      decline_allowed: policy.decline_allowed,
      liability_waiver: copy.liability_waiver,
    },
    account_security: {
      settings_title_he: screen.settings_title_he,
      section_he: copy.section_he,
      status_he: verified ? copy.active_status_he : copy.inactive_status_he,
      pending_he: factors.pendingIds.length > 0 ? screen.pending_he : null,
      enroll_command: 'enroll_mfa' as const,
      enroll_label_he: copy.enroll_label_he,
      enroll_enabled: !verified,
      verify_command: 'verify_mfa' as const,
      verify_label_he: screen.verify_label_he,
      cancel_command: 'cancel_mfa_enrollment' as const,
      cancel_label_he: screen.cancel_label_he,
      remove_command: 'remove_mfa_factor' as const,
      remove_label_he: screen.remove_label_he,
      remove_enabled: verified && !(policy.enforcement_active && policy.requirement === 'mandatory'),
      replace_command: 'replace_mfa_factor' as const,
      replace_label_he: screen.replace_label_he,
      replace_enabled: verified && (assurance ?? ctx.authenticatorAssurance) === 'aal2',
      qr_title_he: screen.qr_title_he,
      code_label_he: screen.code_label_he,
      recovery_unavailable_he: gate.recoveryReady ? 'אפשר להנפיק קודי שחזור אחרי אימות חזק' : screen.recovery_unavailable_he,
      recovery_issue_command: 'issue_mfa_recovery_codes' as const,
      recovery_issue_label_he: 'הנפקת קודי שחזור',
      recovery_issue_enabled: verified && (assurance ?? ctx.authenticatorAssurance) === 'aal2' && gate.recoveryReady,
      recover_command: 'recover_mfa' as const,
      recover_label_he: 'שחזור באמצעות קוד',
      recover_enabled: gate.recoveryReady && (verified || gate.activationState === 'permanently_active'),
      recovery_verify_command: 'verify_mfa_recovery' as const,
      recovery_verify_label_he: 'בדיקת שחזור',
      recovery_verify_enabled: verified && (assurance ?? ctx.authenticatorAssurance) === 'aal2' && gate.recoveryReady,
      trusted_unavailable_he: deviceStatusHe,
      device_status_he: deviceStatusHe,
      devices: devices.map((device) => ({
        ...device,
        revoke_command: 'revoke_trusted_device' as const,
        revoke_label_he: 'ביטול אמון במכשיר',
      })),
      trust_command: 'trust_mfa_device' as const,
      trust_label_he: 'סמן את המכשיר כמהימן',
      trust_enabled: verified && (assurance ?? ctx.authenticatorAssurance) === 'aal2' && gate.trustedDevicesReady,
      suspicious_unavailable_he: screen.suspicious_unavailable_he,
      policy_he: policy.requirement !== 'mandatory' ? screen.optional_he : policy.enforcement_active ? screen.mandatory_active_he : screen.mandatory_inactive_he,
      liability_waiver: copy.liability_waiver,
    },
  };
}

export async function acknowledgeMfaPrompt(ctx: RequestContext, accessToken: string, decisionInput: unknown, warningVersion: unknown) {
  const decision = parseMfaPromptDecision(decisionInput);
  if (!decision || warningVersion !== MFA_PROMPT_WARNING_VERSION) {
    throw badRequest('decision and the current warning_version are required');
  }
  const marker = randomUUID();
  const recordedAt = new Date().toISOString();
  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.user.id,
    entityType: 'security',
    entityId: ctx.user.id,
    action: MFA_PROMPT_ACTION,
    payload: {
      warning_version: MFA_PROMPT_WARNING_VERSION,
      decision,
      liability_waiver: false,
      recorded_at: recordedAt,
      marker,
    },
  });
  const { data, error } = await supabaseAdmin
    .from('audit_log')
    .select('id, created_at, organization_id, actor_user_id, payload_json')
    .eq('actor_user_id', ctx.user.id)
    .eq('action', MFA_PROMPT_ACTION)
    .order('created_at', { ascending: false })
    .limit(1);
  const row = data?.[0];
  const payload = row?.payload_json as { marker?: unknown; decision?: unknown } | null;
  if (error || !row || payload?.marker !== marker || payload.decision !== decision || row.actor_user_id !== ctx.user.id) {
    throw new AppError(503, 'MFA prompt decision was not recorded', 'MFA_PROMPT_NOT_RECORDED');
  }
  if (row.organization_id !== ctx.organizationId) {
    throw new AppError(503, 'MFA prompt decision was not recorded', 'MFA_PROMPT_NOT_RECORDED');
  }
  return {
    aggregate_key: 'mfa_prompt_acknowledgment' as const,
    decision: decision as MfaPromptDecision,
    warning_version: MFA_PROMPT_WARNING_VERSION,
    organization_id: row.organization_id,
    actor_user_id: row.actor_user_id,
    recorded_at: row.created_at,
    liability_waiver: false as const,
    mfa_enabled: false as const,
    next_commands: nextCommandsForMfaPrompt(decision),
    aggregate: await buildMfaOnboardingAggregate(ctx, accessToken),
  };
}

async function unenrollFactor(accessToken: string, factorId: string): Promise<void> {
  const result = await userClient(accessToken).auth.mfa.unenroll({ factorId });
  if (result.error) throw new AppError(401, 'לא ניתן לעדכן את המאמת בלי אימות חזק', 'MFA_RECENT_AUTH_REQUIRED');
}

export async function cancelMfaEnrollment(ctx: RequestContext, accessToken: string) {
  const factors = await totpFactors(accessToken);
  for (const factorId of factors.pendingIds) {
    await unenrollFactor(accessToken, factorId);
  }
  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.user.id,
    entityType: 'security',
    entityId: ctx.user.id,
    action: 'security.mfa_enrollment_cancelled',
    payload: { cancelled_count: factors.pendingIds.length },
  });
  return {
    aggregate_key: 'mfa_enrollment_cancelled' as const,
    mfa_enabled: false as const,
    aggregate: await buildMfaOnboardingAggregate(ctx, accessToken),
  };
}

export async function removeMfaFactor(ctx: RequestContext, accessToken: string, factorIdInput: unknown) {
  await refreshPrivilegedMfaGate();
  if (
    getPrivilegedMfaGate().activationState === 'permanently_active' &&
    isPlatformOwnerSession({
      userEmail: ctx.user.email,
      configuredOwnerEmail: config.platformOwner.email,
      tenantRoleCode: ctx.membership?.roleCode ?? null,
    })
  ) {
    throw new AppError(403, 'לא ניתן להסיר את המאמת אחרי הפעלה לצמיתות', 'MFA_PERMANENTLY_ACTIVE');
  }
  if ((ctx.authenticatorAssurance ?? 'aal1') !== 'aal2') {
    throw new AppError(401, 'כדי להסיר את המאמת צריך אימות חזק מהזמן האחרון', 'MFA_RECENT_AUTH_REQUIRED');
  }
  const factors = await totpFactors(accessToken);
  const requested = typeof factorIdInput === 'string' ? factorIdInput.trim() : '';
  const factorId = factors.verifiedIds.find((id) => id === requested) ?? (factors.verifiedIds.length === 1 ? factors.verifiedIds[0] : '');
  if (!factorId || !factors.verifiedIds.includes(factorId)) {
    throw badRequest('לא נמצא מאמת פעיל להסרה');
  }
  await unenrollFactor(accessToken, factorId);
  await revokeAllTrustedDevices(ctx.user.id);
  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.user.id,
    entityType: 'security',
    entityId: ctx.user.id,
    action: 'security.mfa_factor_removed',
    payload: { factor_id: factorId },
  });
  const aggregate = await buildMfaOnboardingAggregate(ctx, accessToken, 'aal2');
  return { aggregate_key: 'mfa_factor_removed' as const, mfa_enabled: aggregate.mfa_enabled, aggregate };
}

export async function replaceMfaFactor(ctx: RequestContext, accessToken: string) {
  if ((ctx.authenticatorAssurance ?? 'aal1') !== 'aal2') {
    throw new AppError(401, 'כדי להחליף את המאמת צריך אימות חזק מהזמן האחרון', 'MFA_RECENT_AUTH_REQUIRED');
  }
  const existing = await totpFactors(accessToken);
  if (existing.verifiedIds.length === 0) throw badRequest('אין מאמת פעיל להחלפה');
  const enrolled = await enrollMfaFactor(ctx, accessToken);
  return {
    aggregate_key: 'mfa_replacement' as const,
    factor_id: enrolled.factor_id,
    otpauth_uri: enrolled.otpauth_uri,
    previous_factor_remains: true as const,
    aggregate: enrolled.aggregate,
  };
}

async function recoveryStorageReady(): Promise<boolean> {
  const { error } = await supabaseAdmin.from('privileged_mfa_recovery_codes').select('id', { head: true }).limit(1);
  return !error;
}

export async function loadUnusedRecoveryCodes(userId: string): Promise<{
  count: number;
  latestIssuedAt: string | null;
}> {
  const { data, error } = await supabaseAdmin
    .from('privileged_mfa_recovery_codes')
    .select('created_at, consumed_at, expires_at')
    .eq('user_id', userId);
  if (error) {
    if (isMissingRelationError(error)) return { count: 0, latestIssuedAt: null };
    throw new AppError(503, 'קודי השחזור עדיין לא זמינים', 'MFA_RECOVERY_NOT_READY');
  }
  const now = Date.now();
  let latestIssuedAt: string | null = null;
  let count = 0;
  for (const row of data ?? []) {
    const created = typeof row.created_at === 'string' ? row.created_at : '';
    if (created && (!latestIssuedAt || created > latestIssuedAt)) latestIssuedAt = created;
    const expires = typeof row.expires_at === 'string' ? Date.parse(row.expires_at) : 0;
    if (!row.consumed_at && expires > now) count += 1;
  }
  return { count, latestIssuedAt };
}

export async function loadLatestRecoveryDrillAt(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('platform_owner_mfa_recovery_drills')
    .select('verified_at')
    .eq('user_id', userId)
    .order('verified_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingRelationError(error)) return null;
    throw new AppError(503, 'בדיקת השחזור אינה זמינה', 'MFA_RECOVERY_DRILL_UNAVAILABLE');
  }
  return data?.verified_at ? String(data.verified_at) : null;
}

export async function loadActivationRow(): Promise<{ activatedAt: string | null; state: PrivilegedMfaActivationState }> {
  const state = await readPrivilegedMfaActivationState();
  if (state !== 'permanently_active') return { activatedAt: null, state };
  const { data, error } = await supabaseAdmin
    .from('platform_owner_mfa_enforcement')
    .select('activated_at')
    .eq('id', 'platform_owner')
    .maybeSingle();
  if (error) return { activatedAt: null, state };
  return { activatedAt: data?.activated_at ? String(data.activated_at) : null, state };
}

export async function hasVerifiedTotp(accessToken: string): Promise<boolean> {
  const factors = await totpFactors(accessToken);
  return factors.verifiedIds.length > 0;
}

export async function buildPermanentMfaPanel(ctx: RequestContext, accessToken: string) {
  await refreshPrivilegedMfaGate();
  const gate = getPrivilegedMfaGate();
  const [unused, latestDrillAt, totpVerified, activation] = await Promise.all([
    loadUnusedRecoveryCodes(ctx.user.id),
    loadLatestRecoveryDrillAt(ctx.user.id),
    hasVerifiedTotp(accessToken),
    loadActivationRow(),
  ]);
  return permanentMfaPanelView({
    activationState: activation.state === 'unreadable' ? gate.activationState : activation.state,
    totpVerified,
    assurance: ctx.authenticatorAssurance ?? 'aal1',
    unusedRecoveryCount: unused.count,
    recoveryDrillReady: isRecoveryDrillReady({
      latestIssuedAt: unused.latestIssuedAt,
      latestDrillAt,
      unusedRecoveryCount: unused.count,
    }),
    activatedAt: activation.activatedAt,
  });
}

async function consumeUnusedRecoveryCode(userId: string, codeInput: unknown): Promise<{ id: string }> {
  const code = typeof codeInput === 'string' ? codeInput.trim() : '';
  if (!code) throw badRequest('נדרש קוד שחזור');
  const { data, error } = await supabaseAdmin
    .from('privileged_mfa_recovery_codes')
    .select('id, code_hash, code_salt, consumed_at, expires_at')
    .eq('user_id', userId)
    .is('consumed_at', null);
  if (error) throw new AppError(503, 'קודי השחזור עדיין לא זמינים', 'MFA_RECOVERY_NOT_READY');
  const now = Date.now();
  const match = (data ?? []).find((row) => {
    const salt = typeof row.code_salt === 'string' ? row.code_salt : '';
    const hash = typeof row.code_hash === 'string' ? row.code_hash : '';
    const expires = typeof row.expires_at === 'string' ? Date.parse(row.expires_at) : 0;
    return salt && hash && expires > now && recoveryCodeMatches(code, salt, hash);
  });
  if (!match) throw new AppError(401, 'קוד השחזור לא תקף', 'MFA_RECOVERY_FAILED');
  const consumed = await supabaseAdmin
    .from('privileged_mfa_recovery_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', match.id)
    .is('consumed_at', null)
    .select('id');
  if (consumed.error || !consumed.data?.length) throw new AppError(401, 'קוד השחזור לא תקף', 'MFA_RECOVERY_FAILED');
  return { id: match.id };
}

export async function issueMfaRecoveryCodes(ctx: RequestContext, accessToken: string) {
  if (!(await recoveryStorageReady())) {
    throw new AppError(503, 'קודי השחזור עדיין לא זמינים', 'MFA_RECOVERY_NOT_READY');
  }
  if ((ctx.authenticatorAssurance ?? 'aal1') !== 'aal2') {
    throw new AppError(401, 'כדי להנפיק קודי שחזור צריך אימות חזק מהזמן האחרון', 'MFA_RECENT_AUTH_REQUIRED');
  }
  const codes = Array.from({ length: 8 }, () => generateRecoveryCode());
  const rows = codes.map((code) => {
    const hashed = hashRecoveryCode(code);
    return {
      user_id: ctx.user.id,
      code_hash: hashed.hash,
      code_salt: hashed.salt,
      expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    };
  });
  const inserted = await supabaseAdmin.from('privileged_mfa_recovery_codes').insert(rows).select('id');
  if (inserted.error || !inserted.data?.length) throw new AppError(503, 'קודי השחזור עדיין לא זמינים', 'MFA_RECOVERY_NOT_READY');
  const issuedIds = new Set(inserted.data.map((row) => row.id));
  const previous = await supabaseAdmin
    .from('privileged_mfa_recovery_codes')
    .select('id')
    .eq('user_id', ctx.user.id)
    .is('consumed_at', null);
  const retireIds = (previous.data ?? []).map((row) => row.id).filter((id) => !issuedIds.has(id));
  const retired = retireIds.length
    ? await supabaseAdmin
      .from('privileged_mfa_recovery_codes')
      .update({ consumed_at: new Date().toISOString() })
      .in('id', retireIds)
    : { error: null };
  if (retired.error) {
    await supabaseAdmin.from('privileged_mfa_recovery_codes').delete().in('id', [...issuedIds]);
    throw new AppError(503, 'קודי השחזור עדיין לא זמינים', 'MFA_RECOVERY_NOT_READY');
  }
  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.user.id,
    entityType: 'security',
    entityId: ctx.user.id,
    action: 'security.mfa_recovery_issued',
    payload: { code_count: codes.length },
  });
  return {
    aggregate_key: 'mfa_recovery_codes' as const,
    recovery_codes: codes,
    aggregate: await buildMfaOnboardingAggregate(ctx, accessToken, 'aal2'),
  };
}

export async function refreshAuthSession(ctx: RequestContext, refreshToken: string) {
  const refreshed = await createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.refreshSession({ refresh_token: refreshToken });
  const access = refreshed.data.session?.access_token;
  const nextRefresh = refreshed.data.session?.refresh_token;
  if (refreshed.error || !access || !nextRefresh) throw new AppError(401, 'הסשן לא חודש', 'SESSION_REFRESH_FAILED');
  return {
    aggregate_key: 'auth_session_refresh' as const,
    access_token: access,
    refresh_token: nextRefresh,
    aggregate: await buildMfaOnboardingAggregate(ctx, access),
  };
}

export async function trustMfaDevice(ctx: RequestContext, accessToken: string) {
  if ((ctx.authenticatorAssurance ?? 'aal1') !== 'aal2') {
    throw new AppError(401, 'כדי לסמן מכשיר כמהימן צריך אימות חזק מהזמן האחרון', 'MFA_RECENT_AUTH_REQUIRED');
  }
  const issued = await issueTrustedDevice(ctx.user.id);
  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.user.id,
    entityType: 'security',
    entityId: issued.id,
    action: 'security.mfa_device_trusted',
    payload: { device_id: issued.id },
  });
  return {
    aggregate_key: 'mfa_trusted_device' as const,
    device_id: issued.id,
    credential: issued.credential,
    aggregate: await buildMfaOnboardingAggregate(ctx, accessToken, 'aal2'),
  };
}

export async function revokeTrustedDevice(ctx: RequestContext, accessToken: string, deviceIdInput: unknown) {
  const deviceId = typeof deviceIdInput === 'string' ? deviceIdInput.trim() : '';
  if (!deviceId) throw badRequest('נדרש מזהה מכשיר');
  const revoked = await revokeTrustedDeviceForUser(ctx.user.id, deviceId);
  if (!revoked) throw new AppError(404, 'המכשיר לא נמצא', 'TRUSTED_DEVICE_NOT_FOUND');
  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.user.id,
    entityType: 'security',
    entityId: deviceId,
    action: 'security.mfa_device_revoked',
    payload: { device_id: deviceId },
  });
  return {
    aggregate_key: 'mfa_trusted_device_revoked' as const,
    device_id: deviceId,
    aggregate: await buildMfaOnboardingAggregate(ctx, accessToken),
  };
}

/** Consumes one unused recovery code and removes verified factors. Does nothing while storage is absent. */
export async function recoverMfaFactor(ctx: RequestContext, accessToken: string, codeInput: unknown) {
  if (!(await recoveryStorageReady())) {
    throw new AppError(503, 'קודי השחזור עדיין לא זמינים', 'MFA_RECOVERY_NOT_READY');
  }
  const code = typeof codeInput === 'string' ? codeInput.trim() : '';
  if (!code) throw badRequest('נדרש קוד שחזור');
  const { data, error } = await supabaseAdmin
    .from('privileged_mfa_recovery_codes')
    .select('id, code_hash, code_salt, consumed_at, expires_at')
    .eq('user_id', ctx.user.id)
    .is('consumed_at', null);
  if (error) throw new AppError(503, 'קודי השחזור עדיין לא זמינים', 'MFA_RECOVERY_NOT_READY');
  const now = Date.now();
  const match = (data ?? []).find((row) => {
    const salt = typeof row.code_salt === 'string' ? row.code_salt : '';
    const hash = typeof row.code_hash === 'string' ? row.code_hash : '';
    const expires = typeof row.expires_at === 'string' ? Date.parse(row.expires_at) : 0;
    return salt && hash && expires > now && recoveryCodeMatches(code, salt, hash);
  });
  if (!match) throw new AppError(401, 'קוד השחזור לא תקף', 'MFA_RECOVERY_FAILED');
  const factors = await totpFactors(accessToken);
  for (const factorId of factors.verifiedIds) {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/admin/users/${ctx.user.authUserId}/factors/${factorId}`, {
      method: 'DELETE',
      headers: {
        apikey: config.supabaseServiceRoleKey,
        Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      },
    });
    if (!response.ok) throw new AppError(503, 'לא ניתן להסיר את המאמת כרגע', 'MFA_RECOVERY_NOT_READY');
  }
  await revokeAllTrustedDevices(ctx.user.id);
  const consumed = await supabaseAdmin
    .from('privileged_mfa_recovery_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', match.id)
    .is('consumed_at', null)
    .select('id');
  if (consumed.error || !consumed.data?.length) throw new AppError(401, 'קוד השחזור לא תקף', 'MFA_RECOVERY_FAILED');
  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.user.id,
    entityType: 'security',
    entityId: ctx.user.id,
    action: 'security.mfa_recovery_consumed',
    payload: { factor_count: factors.verifiedIds.length },
  });
  await recordSecurityEvent({
    action: 'security.mfa_recovery_consumed',
    dedupeKey: `mfa-recovery:${ctx.user.id}`,
    actorUserId: ctx.user.id,
    payload: { kind: 'mfa_recovery_consumed' },
  });
  await refreshPrivilegedMfaGate({ force: true });
  const shouldIssue = decideRecoveryGrantIssue({
    permanentlyActive: getPrivilegedMfaGate().activationState === 'permanently_active',
    platformOwner: isCurrentPlatformOwner(ctx),
  });
  const recoveryEnrollmentGrant = shouldIssue === 'issue' ? await issueRecoveryEnrollmentGrant(ctx.user.id) : null;
  if (recoveryEnrollmentGrant) {
    await writeAudit({
      organizationId: ctx.organizationId,
      actorUserId: ctx.user.id,
      entityType: 'security',
      entityId: ctx.user.id,
      action: 'security.mfa_recovery_grant_issued',
      payload: { purpose: 'reenroll_totp', ttl_seconds: 900 },
    });
  }
  return {
    aggregate_key: 'mfa_recovery' as const,
    enforcement_unchanged: true as const,
    recovery_enrollment_grant: recoveryEnrollmentGrant,
    next_commands: ['enroll_mfa'] as const,
    aggregate: await buildMfaOnboardingAggregate(ctx, accessToken),
  };
}

/** Consumes one unused recovery code and records a drill. Keeps TOTP and does not change enforcement. */
export async function verifyMfaRecovery(ctx: RequestContext, accessToken: string, codeInput: unknown) {
  if (!(await recoveryStorageReady())) {
    throw new AppError(503, 'קודי השחזור עדיין לא זמינים', 'MFA_RECOVERY_NOT_READY');
  }
  if ((ctx.authenticatorAssurance ?? 'aal1') !== 'aal2') {
    throw new AppError(401, 'כדי לבדוק שחזור צריך אימות חזק מהזמן האחרון', 'MFA_RECENT_AUTH_REQUIRED');
  }
  const factors = await totpFactors(accessToken);
  if (factors.verifiedIds.length === 0) throw badRequest('אין מאמת פעיל לבדיקת שחזור');
  const consumed = await consumeUnusedRecoveryCode(ctx.user.id, codeInput);
  const drilled = await supabaseAdmin
    .from('platform_owner_mfa_recovery_drills')
    .insert({ user_id: ctx.user.id, consumed_code_id: consumed.id })
    .select('id, verified_at')
    .maybeSingle();
  if (drilled.error || !drilled.data) {
    if (isMissingRelationError(drilled.error)) {
      throw new AppError(503, 'בדיקת השחזור אינה זמינה', 'MFA_RECOVERY_DRILL_UNAVAILABLE');
    }
    throw new AppError(503, 'בדיקת השחזור לא נרשמה', 'MFA_RECOVERY_DRILL_FAILED');
  }
  await writeAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.user.id,
    entityType: 'security',
    entityId: ctx.user.id,
    action: 'security.mfa_recovery_verified',
    payload: { drill_id: drilled.data.id },
  });
  return {
    aggregate_key: 'mfa_recovery_verified' as const,
    enforcement_unchanged: true as const,
    aggregate: await buildMfaOnboardingAggregate(ctx, accessToken, 'aal2'),
  };
}
