const SENSITIVE_KEY = /email|password|token|authorization|secret|storage_key|body|otp|cookie/i;

export function safeSecurityPayload(input: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (typeof value === 'string') {
      if (value.includes('@') || value.includes('eyJ') || value.includes('sbp_') || value.includes('sb_')) continue;
      out[key] = value.slice(0, 80);
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) out[key] = value;
  }
  return out;
}

export type SecurityRecordDecision =
  | { record: false }
  | { record: true; action: string; repeated: boolean };

export function securityActionForStatus(status: number, code: string | undefined): string | null {
  if (status !== 401 && status !== 403) return null;
  if (code === 'USER_NOT_ACTIVE') return 'security.account_inactive';
  if (code === 'MFA_REQUIRED') return 'security.privileged_mfa_failed';
  if (status === 401) return 'security.unauthorized';
  return 'security.forbidden';
}

/** First event is stored. Events 2–4 are suppressed. The 5th becomes one repeated-access event. */
export function decideSecurityRecord(countInWindow: number, action: string): SecurityRecordDecision {
  if (countInWindow <= 1) return { record: true, action, repeated: false };
  if (countInWindow === 5) return { record: true, action: 'security.suspicious_repeated', repeated: true };
  return { record: false };
}
