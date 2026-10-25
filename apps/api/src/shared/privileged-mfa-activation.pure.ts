import type { AuthenticatorAssurance, PrivilegedMfaOutcome } from './privileged-mfa.pure.js';

export type PrivilegedMfaActivationState = 'not_activated' | 'permanently_active' | 'unreadable';
export type PresenceObservation = 'absent' | 'present' | 'unreadable';
export type EnforcementObservation =
  | 'absent'
  | 'not_activated'
  | 'permanently_active'
  | 'corrupt'
  | 'unreadable';

export type PermanentMfaActivationDecision =
  | { outcome: 'activate' }
  | { outcome: 'already_active' }
  | { outcome: 'reject'; code: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseActivationRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return UUID_RE.test(id) ? id : null;
}

export function isMissingRelationError(error: { code?: string; message?: string } | null | undefined): boolean {
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes('does not exist') ||
    message.includes('could not find the table')
  );
}

/**
 * Durable distinction:
 * - schema+enforcement absent = install before 203, not activated
 * - enforcement NOT_ACTIVATED and no receipt/audit = explicitly not activated
 * - enforcement / receipt / audit / previous permanently active = permanently active
 * - unreadable or corrupt after any activation witness = fail closed as permanently active
 */
export function resolvePrivilegedMfaActivationState(input: {
  schema: PresenceObservation;
  enforcement: EnforcementObservation;
  receipt: PresenceObservation;
  activationAudit: PresenceObservation;
  previous: PrivilegedMfaActivationState;
}): PrivilegedMfaActivationState {
  const witnessed =
    input.enforcement === 'permanently_active' ||
    input.receipt === 'present' ||
    input.activationAudit === 'present' ||
    input.previous === 'permanently_active';

  if (
    input.schema === 'unreadable' ||
    input.enforcement === 'unreadable' ||
    input.receipt === 'unreadable' ||
    input.activationAudit === 'unreadable' ||
    input.enforcement === 'corrupt'
  ) {
    return witnessed ? 'permanently_active' : 'unreadable';
  }

  if (witnessed) return 'permanently_active';
  return 'not_activated';
}

export function decideRecoveryGrantIssue(input: { permanentlyActive: boolean; platformOwner: boolean }): 'issue' | 'skip' {
  return input.permanentlyActive && input.platformOwner ? 'issue' : 'skip';
}

export function decideRecoveryEnrollment(input: {
  permanentlyActive: boolean;
  platformOwner: boolean;
  assurance: AuthenticatorAssurance;
  grant: 'valid' | 'missing' | 'used' | 'expired' | 'unreadable';
}): 'allow' | 'reject' {
  if (!input.permanentlyActive || !input.platformOwner) return 'allow';
  if (input.assurance === 'aal2') return 'allow';
  return input.grant === 'valid' ? 'allow' : 'reject';
}

export function decideRecoveryGrantStatus(input: {
  consumedAt: string | null;
  expiresAt: string;
  now: string;
}): 'valid' | 'used' | 'expired' {
  if (input.consumedAt) return 'used';
  if (Date.parse(input.expiresAt) <= Date.parse(input.now)) return 'expired';
  return 'valid';
}

/** Tables 200/201 never activate enforcement. Only the persisted one-way state does. */
export function decidePrivilegedMfaFromActivation(input: {
  activationState: PrivilegedMfaActivationState;
  assurance: AuthenticatorAssurance;
  privileged: boolean;
  enrollmentRoute: boolean;
  suspiciousSignIn?: boolean;
}): PrivilegedMfaOutcome {
  if (!input.privileged || input.enrollmentRoute) return { outcome: 'allow' };
  if (input.activationState === 'unreadable') return { outcome: 'deny', code: 'MFA_REQUIRED' };
  if (input.assurance === 'aal2') return { outcome: 'allow' };
  if (input.activationState === 'permanently_active') return { outcome: 'deny', code: 'MFA_REQUIRED' };
  if (input.suspiciousSignIn) return { outcome: 'deny', code: 'MFA_REQUIRED' };
  return { outcome: 'allow' };
}

export function decidePermanentMfaActivation(input: {
  platformOwner: boolean;
  alreadyActive: boolean;
  assurance: AuthenticatorAssurance;
  totpVerified: boolean;
  recoveryStorageReady: boolean;
  unusedRecoveryCount: number;
  recoveryDrillReady: boolean;
}): PermanentMfaActivationDecision {
  if (!input.platformOwner) return { outcome: 'reject', code: 'PLATFORM_OWNER_REQUIRED' };
  if (input.alreadyActive) return { outcome: 'already_active' };
  if (input.assurance !== 'aal2') return { outcome: 'reject', code: 'MFA_RECENT_AUTH_REQUIRED' };
  if (!input.totpVerified) return { outcome: 'reject', code: 'MFA_ENROLLMENT_REQUIRED' };
  if (!input.recoveryStorageReady || input.unusedRecoveryCount < 1) {
    return { outcome: 'reject', code: 'MFA_RECOVERY_REQUIRED' };
  }
  if (!input.recoveryDrillReady) return { outcome: 'reject', code: 'MFA_RECOVERY_DRILL_REQUIRED' };
  return { outcome: 'activate' };
}

export function isRecoveryDrillReady(input: {
  latestIssuedAt: string | null;
  latestDrillAt: string | null;
  unusedRecoveryCount: number;
}): boolean {
  return Boolean(
    input.latestIssuedAt &&
      input.latestDrillAt &&
      input.latestDrillAt >= input.latestIssuedAt &&
      input.unusedRecoveryCount >= 1,
  );
}

export function resolveActivationWrite(input: {
  inserted: boolean;
  uniqueViolation: boolean;
  persistedState: PrivilegedMfaActivationState;
}): 'activated' | 'already_active' | 'failed' {
  if (input.persistedState === 'permanently_active') {
    return input.inserted ? 'activated' : 'already_active';
  }
  if (input.uniqueViolation) return 'failed';
  return 'failed';
}

export function permanentMfaPanelView(input: {
  activationState: PrivilegedMfaActivationState;
  totpVerified: boolean;
  assurance: AuthenticatorAssurance;
  unusedRecoveryCount: number;
  recoveryDrillReady: boolean;
  activatedAt: string | null;
}): {
  enforcement: 'NOT_ACTIVATED' | 'PERMANENTLY_ACTIVE' | 'UNREADABLE';
  enrollment_complete: boolean;
  totp_session_verified: boolean;
  recovery_codes_ready: boolean;
  recovery_procedure_tested: boolean;
  enrollment_status_he: string;
  totp_status_he: string;
  recovery_status_he: string;
  drill_status_he: string;
  enforcement_status_he: string;
  activate_command: 'activate_platform_owner_mfa';
  activate_enabled: boolean;
  activate_label_he: string;
  active_label_he: string;
  activated_at: string | null;
  verify_recovery_command: 'verify_mfa_recovery';
  verify_recovery_enabled: boolean;
  verify_recovery_label_he: string;
} {
  const permanentlyActive = input.activationState === 'permanently_active';
  const activateEnabled =
    !permanentlyActive &&
    input.activationState !== 'unreadable' &&
    input.totpVerified &&
    input.assurance === 'aal2' &&
    input.unusedRecoveryCount > 0 &&
    input.recoveryDrillReady;
  return {
    enforcement:
      input.activationState === 'permanently_active'
        ? 'PERMANENTLY_ACTIVE'
        : input.activationState === 'unreadable'
          ? 'UNREADABLE'
          : 'NOT_ACTIVATED',
    enrollment_complete: input.totpVerified,
    totp_session_verified: input.assurance === 'aal2',
    recovery_codes_ready: input.unusedRecoveryCount > 0,
    recovery_procedure_tested: input.recoveryDrillReady,
    enrollment_status_he: input.totpVerified ? 'מאמת רשום ומאומת' : 'ההרשמה למאמת לא הושלמה',
    totp_status_he: input.assurance === 'aal2' ? 'הסשן אומת בקוד' : 'נדרש אימות קוד טרי',
    recovery_status_he: input.unusedRecoveryCount > 0 ? 'קודי שחזור מוכנים' : 'אין קודי שחזור זמינים',
    drill_status_he: input.recoveryDrillReady ? 'הליך השחזור נבדק' : 'יש לבדוק את הליך השחזור',
    enforcement_status_he: permanentlyActive
      ? 'MFA פעיל לצמיתות'
      : input.activationState === 'unreadable'
        ? 'מצב ההפעלה אינו קריא'
        : 'MFA עדיין לא הופעל',
    activate_command: 'activate_platform_owner_mfa',
    activate_enabled: activateEnabled,
    activate_label_he: 'הפעלת MFA לצמיתות',
    active_label_he: 'MFA פעיל לצמיתות',
    activated_at: permanentlyActive ? input.activatedAt : null,
    verify_recovery_command: 'verify_mfa_recovery',
    verify_recovery_enabled: input.totpVerified && input.assurance === 'aal2' && input.unusedRecoveryCount > 0,
    verify_recovery_label_he: 'בדיקת שחזור',
  };
}
