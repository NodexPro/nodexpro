export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low';
export type SecurityConfidence = 'confirmed' | 'suspicious' | 'benign';
export type ContainmentAction = 'none' | 'temporary_source_block' | 'restrict_user_sensitive_commands' | 'owner_review';
export type ContainmentScope = 'source_ip' | 'user' | 'session';

export type SecurityRuleDecision = {
  rule_id: string;
  event_type: string;
  severity: SecuritySeverity;
  confidence: SecurityConfidence;
  threshold: number;
  window_seconds: number;
  containment_action: ContainmentAction;
  containment_scope: ContainmentScope | null;
  containment_ttl_seconds: number;
  evidence_summary: string;
};

type RuleDef = {
  matches: (action: string) => boolean;
  rule_id: string;
  event_type: string;
  severity: SecuritySeverity;
  confidence: SecurityConfidence;
  threshold: number;
  window_seconds: number;
  containment_action: ContainmentAction;
  containment_scope: ContainmentScope | null;
  containment_ttl_seconds: number;
  evidence_summary: string;
};

const TEN_MIN = 10 * 60;
const FIFTEEN_MIN = 15 * 60;
const HOUR = 60 * 60;

const RULES: RuleDef[] = [
  {
    matches: (action) => action === 'security.login_failed',
    rule_id: 'auth_failed_login_burst_v1',
    event_type: 'repeated_failed_login_attempts',
    severity: 'high',
    confidence: 'suspicious',
    threshold: 5,
    window_seconds: TEN_MIN,
    containment_action: 'owner_review',
    containment_scope: null,
    containment_ttl_seconds: 0,
    evidence_summary: 'Repeated failed login attempts crossed the configured threshold.',
  },
  {
    matches: (action) => action === 'security.suspicious_sign_in' || action === 'security.suspicious_repeated',
    rule_id: 'auth_suspicious_pattern_v1',
    event_type: 'suspicious_authentication_activity',
    severity: 'high',
    confidence: 'suspicious',
    threshold: 1,
    window_seconds: FIFTEEN_MIN,
    containment_action: 'owner_review',
    containment_scope: null,
    containment_ttl_seconds: 0,
    evidence_summary: 'Authentication activity matched an existing suspicious pattern.',
  },
  {
    matches: (action) => action === 'security.privileged_mfa_failed',
    rule_id: 'privileged_mfa_failure_v1',
    event_type: 'privileged_mfa_access_failure',
    severity: 'critical',
    confidence: 'confirmed',
    threshold: 1,
    window_seconds: FIFTEEN_MIN,
    containment_action: 'owner_review',
    containment_scope: null,
    containment_ttl_seconds: 0,
    evidence_summary: 'Privileged access was denied by MFA enforcement.',
  },
  {
    matches: (action) => action === 'security.platform_owner_mfa_activated' || action === 'security.mfa_recovery_consumed',
    rule_id: 'privileged_mfa_lifecycle_v1',
    event_type: 'privileged_mfa_lifecycle_event',
    severity: 'critical',
    confidence: 'confirmed',
    threshold: 1,
    window_seconds: HOUR,
    containment_action: 'owner_review',
    containment_scope: null,
    containment_ttl_seconds: 0,
    evidence_summary: 'A high-risk privileged MFA lifecycle event was recorded.',
  },
  {
    matches: (action) => action === 'security.forbidden',
    rule_id: 'forbidden_api_burst_v1',
    event_type: 'repeated_forbidden_api_requests',
    severity: 'medium',
    confidence: 'suspicious',
    threshold: 8,
    window_seconds: TEN_MIN,
    containment_action: 'restrict_user_sensitive_commands',
    containment_scope: 'user',
    containment_ttl_seconds: FIFTEEN_MIN,
    evidence_summary: 'Repeated forbidden API responses crossed the configured threshold.',
  },
  {
    matches: (action) => action === 'security.unauthorized',
    rule_id: 'unauthorized_api_burst_v1',
    event_type: 'repeated_unauthorized_api_requests',
    severity: 'medium',
    confidence: 'suspicious',
    threshold: 12,
    window_seconds: TEN_MIN,
    containment_action: 'owner_review',
    containment_scope: null,
    containment_ttl_seconds: 0,
    evidence_summary: 'Repeated unauthorized API responses crossed the configured threshold.',
  },
  {
    matches: (action) => action === 'security.alert_delivery_failed',
    rule_id: 'security_integration_failure_v1',
    event_type: 'security_integration_failure',
    severity: 'critical',
    confidence: 'confirmed',
    threshold: 1,
    window_seconds: HOUR,
    containment_action: 'owner_review',
    containment_scope: null,
    containment_ttl_seconds: 0,
    evidence_summary: 'Security alert delivery failed and requires Platform Owner review.',
  },
];

export function ruleForSecurityAction(action: string): SecurityRuleDecision | null {
  const rule = RULES.find((item) => item.matches(action));
  if (!rule) return null;
  return {
    rule_id: rule.rule_id,
    event_type: rule.event_type,
    severity: rule.severity,
    confidence: rule.confidence,
    threshold: rule.threshold,
    window_seconds: rule.window_seconds,
    containment_action: rule.containment_action,
    containment_scope: rule.containment_scope,
    containment_ttl_seconds: rule.containment_ttl_seconds,
    evidence_summary: rule.evidence_summary,
  };
}

export function shouldCreateIncident(countInWindow: number, decision: SecurityRuleDecision): boolean {
  return countInWindow >= decision.threshold;
}

export function containmentActionIsAutomatic(action: ContainmentAction): boolean {
  return action === 'temporary_source_block' || action === 'restrict_user_sensitive_commands';
}

/** Exact `true` only. Absent, empty, `false`, `1`, `yes` and any other value stay disabled. */
export function isSecurityContainmentEnabled(raw: string | null | undefined): boolean {
  return String(raw ?? '').trim().toLowerCase() === 'true';
}

export function isContainmentExemptPath(path: string | null | undefined): boolean {
  const value = String(path ?? '');
  return (
    value === '/api/v1/health' ||
    value.startsWith('/api/v1/owner') ||
    value.includes('/internal/')
  );
}

export type ContainmentSafetyInput = {
  enabled: boolean;
  action: ContainmentAction;
  scope: ContainmentScope | null;
  sourceIp: string | null;
  actorUserId: string | null;
  isPlatformOwnerActor: boolean;
  isPrivateOrReservedSource: boolean;
};

export type ContainmentSafetyDecision = {
  apply: boolean;
  reason:
    | 'kill_switch_disabled'
    | 'owner_review_only'
    | 'source_ip_auto_containment_disabled'
    | 'private_or_reserved_source'
    | 'missing_actor'
    | 'platform_owner_protected'
    | 'authenticated_actor_only';
};

/**
 * Automatic containment is limited to the authenticated attacker.
 * Source-IP blocks are never applied automatically: shared NAT, office, VPN and
 * mobile networks would otherwise lock legitimate users, including Platform Owner.
 */
export function decideAutomaticContainment(input: ContainmentSafetyInput): ContainmentSafetyDecision {
  if (!input.enabled) return { apply: false, reason: 'kill_switch_disabled' };
  if (!containmentActionIsAutomatic(input.action) || !input.scope) {
    return { apply: false, reason: 'owner_review_only' };
  }
  if (input.scope === 'source_ip' || input.scope === 'session') {
    if (input.isPrivateOrReservedSource) return { apply: false, reason: 'private_or_reserved_source' };
    return { apply: false, reason: 'source_ip_auto_containment_disabled' };
  }
  if (!input.actorUserId) return { apply: false, reason: 'missing_actor' };
  if (input.isPlatformOwnerActor) return { apply: false, reason: 'platform_owner_protected' };
  return { apply: true, reason: 'authenticated_actor_only' };
}

export function shouldEnforceRecordedContainment(input: {
  enabled: boolean;
  path?: string | null;
  scope: ContainmentScope;
  isPlatformOwnerActor: boolean;
  isPrivateOrReservedSource: boolean;
}): boolean {
  if (!input.enabled) return false;
  if (isContainmentExemptPath(input.path)) return false;
  if (input.isPlatformOwnerActor) return false;
  if (input.scope === 'source_ip' || input.scope === 'session') return false;
  return input.scope === 'user';
}

