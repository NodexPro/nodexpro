export const HIGH_RISK_FAILED_LOGIN_AT = 4;

export type HighRiskLoginDecision = 'allow' | 'require_aal2' | 'allow_and_alert';

/** Backend-owned stolen-password decision. Does not enroll MFA and does not lock the account. */
export function decideHighRiskPasswordLogin(input: {
  recentFailCount: number;
  mfaEnrolled: boolean;
  assurance: 'aal1' | 'aal2';
}): HighRiskLoginDecision {
  if (input.recentFailCount < HIGH_RISK_FAILED_LOGIN_AT) return 'allow';
  if (input.assurance === 'aal2') return 'allow_and_alert';
  if (input.mfaEnrolled) return 'require_aal2';
  return 'allow_and_alert';
}

export function highRiskLoginChallenge(decision: HighRiskLoginDecision): {
  required: boolean;
  command: 'verify_mfa' | null;
  reason: 'high_risk_context' | null;
} {
  if (decision === 'require_aal2') {
    return { required: true, command: 'verify_mfa', reason: 'high_risk_context' };
  }
  return { required: false, command: null, reason: null };
}

export function isHighRiskChallengePath(path: string): boolean {
  const value = String(path ?? '').split('?')[0] ?? '';
  return (
    /\/auth\/(me|session|logout)$/.test(value)
    || /\/auth\/aggregates\/mfa$/.test(value)
    || /\/auth\/commands\/verify_mfa$/.test(value)
    || /\/auth\/commands\/verify_mfa_recovery$/.test(value)
  );
}
