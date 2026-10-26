export const FAILED_LOGIN_WINDOW_SECONDS = 10 * 60;
export const FAILED_LOGIN_COOLDOWN_SECONDS = 3 * 60;
export const FAILED_LOGIN_RECOVERY_AT = 3;
export const FAILED_LOGIN_SUSPICIOUS_AT = 4;
export const FAILED_LOGIN_COOLDOWN_AT = 7;
export const FAILED_LOGIN_INCIDENT_AT = 10;

export type FailedLoginStage = 'journal' | 'recovery' | 'suspicious' | 'cooldown' | 'incident';

export function failedLoginStage(countInWindow: number): FailedLoginStage {
  if (countInWindow >= FAILED_LOGIN_INCIDENT_AT) return 'incident';
  if (countInWindow >= FAILED_LOGIN_COOLDOWN_AT) return 'cooldown';
  if (countInWindow >= FAILED_LOGIN_SUSPICIOUS_AT) return 'suspicious';
  if (countInWindow >= FAILED_LOGIN_RECOVERY_AT) return 'recovery';
  return 'journal';
}

export function shouldOfferPasswordRecovery(countInWindow: number): boolean {
  return countInWindow >= FAILED_LOGIN_RECOVERY_AT;
}

export function shouldSkipPasswordVerification(input: {
  cooldownAlreadyActive: boolean;
  loginSucceeded: boolean;
}): boolean {
  if (input.loginSucceeded) return false;
  return input.cooldownAlreadyActive;
}

export function failedLoginSeverity(stage: FailedLoginStage): 'low' | 'high' {
  return stage === 'journal' || stage === 'recovery' ? 'low' : 'high';
}

export function shouldCreateFailedLoginIncident(countInWindow: number): boolean {
  return countInWindow >= FAILED_LOGIN_INCIDENT_AT;
}

export function shouldNotifyOwnerForFailedLogin(countInWindow: number): boolean {
  return countInWindow >= FAILED_LOGIN_INCIDENT_AT;
}

export function normalizeLoginStamp(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{16,64}$/.test(value)) return null;
  return value;
}

export function failedLoginCorrelationCounts(input: {
  patternCount: number;
  stampCount: number;
  targetCount: number;
}): { detectionCount: number; cooldownCount: number; incidentCount: number } {
  const patternCount = Math.max(0, input.patternCount);
  const stampCount = Math.max(0, input.stampCount);
  const targetCount = Math.max(0, input.targetCount);
  return {
    detectionCount: Math.max(patternCount, stampCount, targetCount),
    cooldownCount: Math.max(patternCount, stampCount),
    incidentCount: Math.max(patternCount, stampCount, targetCount),
  };
}

export function shouldApplyFailedLoginCooldown(input: {
  countInWindow: number;
  loginSucceeded: boolean;
  isPlatformOwnerEmergency: boolean;
}): boolean {
  if (input.loginSucceeded || input.isPlatformOwnerEmergency) return false;
  return input.countInWindow >= FAILED_LOGIN_COOLDOWN_AT;
}

/** Cooldown is an auth rate limit, not Phase 5 containment. */
export function failedLoginCooldownIsContainment(): boolean {
  return false;
}

export function maskAttemptedIdentifier(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return null;
  const at = value.indexOf('@');
  if (at <= 0 || at === value.length - 1) return '***';
  const local = value.slice(0, at);
  const domain = value.slice(at + 1).slice(0, 80);
  return `${local.slice(0, 1)}***@${domain}`;
}

export function failedLoginDetectionReason(stage: FailedLoginStage, distinctTargets: number): string {
  if (stage === 'incident') {
    return distinctTargets > 1
      ? 'Ten or more failed logins from the same attempt pattern across multiple identities.'
      : 'Ten or more failed logins from the same attempt pattern.';
  }
  if (stage === 'cooldown') return 'Failed-login attempt pattern reached the temporary cooldown threshold.';
  if (stage === 'suspicious') return 'Repeated failed logins from the same attempt pattern.';
  if (stage === 'recovery') return 'Failed login recorded; password recovery is offered.';
  return 'Failed login recorded in the security journal.';
}

export function failedLoginGroupKey(input: {
  displayIp: string;
  attemptedIdentifierHash: string | null;
  stampHash?: string | null;
}): string {
  if (input.stampHash) return `login:stamp:${input.stampHash}:${input.attemptedIdentifierHash ?? 'none'}`;
  if (input.attemptedIdentifierHash) return `login:target:${input.attemptedIdentifierHash}`;
  return `login:ip:${input.displayIp}`;
}

export type JournalGroup = {
  group_key: string;
  action: string;
  severity: string;
  created_at: string;
  display_ip: string;
  country: string;
  city: string;
  attempted_identifier: string | null;
  attempt_count: number;
  detection_reason: string;
  incident_id: string | null;
  cooldown_status: string;
  containment_action: string;
  alert_status: string;
  history: Array<{ id: string; created_at: string; attempt_count: number }>;
};

export function groupSecurityJournalRows(
  rows: Array<{
    id: string;
    created_at: string;
    action: string;
    severity: string;
    display_ip: string;
    country: string;
    city: string;
    attempted_identifier: string | null;
    attempted_identifier_hash: string | null;
    attempt_count: number;
    detection_reason: string;
    incident_id: string | null;
    cooldown_status: string;
    containment_action: string;
    alert_status: string;
    group_key: string;
  }>,
  page: number,
  pageSize: number,
): { groups: JournalGroup[]; total_groups: number; page: number; page_size: number } {
  const map = new Map<string, JournalGroup>();
  for (const row of rows) {
    const existing = map.get(row.group_key);
    if (!existing) {
      map.set(row.group_key, {
        group_key: row.group_key,
        action: row.action,
        severity: row.severity,
        created_at: row.created_at,
        display_ip: row.display_ip,
        country: row.country,
        city: row.city,
        attempted_identifier: row.attempted_identifier,
        attempt_count: row.attempt_count,
        detection_reason: row.detection_reason,
        incident_id: row.incident_id,
        cooldown_status: row.cooldown_status,
        containment_action: row.containment_action,
        alert_status: row.alert_status,
        history: [{ id: row.id, created_at: row.created_at, attempt_count: row.attempt_count }],
      });
      continue;
    }
    existing.attempt_count = Math.max(existing.attempt_count, row.attempt_count);
    existing.history.push({ id: row.id, created_at: row.created_at, attempt_count: row.attempt_count });
    if (row.created_at > existing.created_at) {
      existing.created_at = row.created_at;
      existing.severity = row.severity;
      existing.detection_reason = row.detection_reason;
      existing.incident_id = row.incident_id ?? existing.incident_id;
      existing.cooldown_status = row.cooldown_status;
      existing.alert_status = row.alert_status;
      existing.containment_action = row.containment_action;
    }
  }
  const groups = [...map.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const safePage = Math.max(1, page);
  const safeSize = Math.min(50, Math.max(1, pageSize));
  const start = (safePage - 1) * safeSize;
  return {
    groups: groups.slice(start, start + safeSize),
    total_groups: groups.length,
    page: safePage,
    page_size: safeSize,
  };
}
