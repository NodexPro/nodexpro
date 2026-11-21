/** MFA login/session truth. Enrollment is not a challenge, and a pending factor is not enabled. */

export type MfaEnrollmentState = 'not_enrolled' | 'enrollment_pending' | 'enabled';
export type MfaPolicyRequirement = 'optional' | 'mandatory';
export type MfaChallengeReason = 'mfa_enabled' | 'high_risk_context' | null;
export type MfaVerifyMode = 'login_step_up' | 'enrollment' | 'none';

export type MfaFactorRecord = {
  id?: unknown;
  status?: unknown;
  factor_type?: unknown;
};

export type MfaSessionSnapshot = {
  enrollment_state: MfaEnrollmentState;
  challenge_required: boolean;
  policy_requirement: MfaPolicyRequirement;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asFactorRecords(value: unknown): MfaFactorRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MfaFactorRecord => Boolean(item) && typeof item === 'object');
}

/** Admin `{ factors }`, user `{ all, totp }`, or a raw factor array. */
export function parseMfaFactorRecords(listed: unknown): MfaFactorRecord[] {
  if (Array.isArray(listed)) return asFactorRecords(listed);
  const root = asRecord(listed);
  if (!root) return [];
  const nested = asRecord(root.data) ?? root;
  const deeper = asRecord(nested.data) ?? nested;
  const collected = [
    ...asFactorRecords(deeper.factors),
    ...asFactorRecords(deeper.all),
    ...asFactorRecords(deeper.totp),
    ...asFactorRecords(nested.factors),
    ...asFactorRecords(nested.all),
    ...asFactorRecords(nested.totp),
  ];
  const seen = new Set<string>();
  const unique: MfaFactorRecord[] = [];
  for (const factor of collected) {
    const id = typeof factor.id === 'string' ? factor.id : '';
    const key = id || `${String(factor.status ?? '')}:${unique.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(factor);
  }
  return unique;
}

function isTotpFactor(factor: MfaFactorRecord): boolean {
  const type = typeof factor.factor_type === 'string' ? factor.factor_type : 'totp';
  return type === 'totp';
}

export function classifyMfaEnrollment(factors: MfaFactorRecord[]): MfaEnrollmentState {
  const totp = factors.filter(isTotpFactor);
  if (totp.some((factor) => factor.status === 'verified')) return 'enabled';
  if (totp.some((factor) => factor.status === 'unverified')) return 'enrollment_pending';
  return 'not_enrolled';
}

export function classifyMfaEnrollmentFromListed(listed: unknown): MfaEnrollmentState {
  return classifyMfaEnrollment(parseMfaFactorRecords(listed));
}

/**
 * Challenge only when a verified factor exists (or high-risk already required aal2).
 * Pending enrollment and unenrolled users receive a full session.
 */
export function decideMfaChallenge(input: {
  enrollment: MfaEnrollmentState;
  assurance: 'aal1' | 'aal2';
  highRiskAal2Required?: boolean;
}): { challengeRequired: boolean; reason: MfaChallengeReason } {
  if (input.assurance === 'aal2') return { challengeRequired: false, reason: null };
  if (input.enrollment === 'enabled') return { challengeRequired: true, reason: 'mfa_enabled' };
  if (input.highRiskAal2Required) return { challengeRequired: true, reason: 'high_risk_context' };
  return { challengeRequired: false, reason: null };
}

export function mfaSessionSnapshot(input: {
  enrollment: MfaEnrollmentState;
  challengeRequired: boolean;
  policyRequirement: MfaPolicyRequirement;
}): MfaSessionSnapshot {
  return {
    enrollment_state: input.enrollment,
    challenge_required: input.challengeRequired,
    policy_requirement: input.policyRequirement,
  };
}

export function mfaPolicyRequirement(input: {
  platformOwner: boolean;
  activationState: 'not_activated' | 'permanently_active' | 'unreadable' | string;
}): MfaPolicyRequirement {
  if (!input.platformOwner) return 'optional';
  return input.activationState === 'permanently_active' || input.activationState === 'unreadable'
    ? 'mandatory'
    : 'optional';
}

export function loginChallengePayload(input: {
  required: boolean;
  reason: MfaChallengeReason;
}): { required: boolean; command: 'verify_mfa' | null; reason: MfaChallengeReason } {
  if (!input.required) return { required: false, command: null, reason: null };
  return { required: true, command: 'verify_mfa', reason: input.reason };
}

/**
 * Non-identity APIs stay blocked at aal1 when MFA is enabled, including a restored password session.
 * Identity bootstrap (/auth/session, verify_mfa) stays open so the challenge can complete.
 */
export function aal1RequestRequiresMfaChallenge(input: {
  identityBootstrap: boolean;
  assurance: 'aal1' | 'aal2';
  enrollment: MfaEnrollmentState | null;
  highRiskPending: boolean;
  mfaChallengePending: boolean;
}): boolean {
  if (input.assurance === 'aal2' || input.identityBootstrap) return false;
  if (input.highRiskPending) return true;
  if (input.enrollment === 'enabled') return true;
  if (input.enrollment == null && input.mfaChallengePending) return true;
  return false;
}

/** Login sends only the TOTP code. Settings enrollment sends the pending factor id. */
export function resolveLoginMfaFactor(input: {
  requestedFactorId: string;
  verifiedIds: string[];
  pendingIds: string[];
}): { factorId: string | null; mode: MfaVerifyMode } {
  const requested = input.requestedFactorId.trim();
  if (requested) {
    if (input.pendingIds.includes(requested)) return { factorId: requested, mode: 'enrollment' };
    if (input.verifiedIds.includes(requested)) return { factorId: requested, mode: 'login_step_up' };
    return { factorId: null, mode: 'none' };
  }
  const verified = input.verifiedIds[0];
  if (verified) return { factorId: verified, mode: 'login_step_up' };
  return { factorId: null, mode: 'none' };
}
