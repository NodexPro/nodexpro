/** Presentation-only English copy for the Platform Owner Security page. */

export const OWNER_SECURITY_TABS = ['mfa', 'alerts'] as const;
export type OwnerSecurityTab = (typeof OWNER_SECURITY_TABS)[number];

export function resolveOwnerSecurityTab(raw: string | null): OwnerSecurityTab {
  return raw === 'alerts' ? 'alerts' : 'mfa';
}

export const OWNER_SECURITY_COPY = {
  pageTitle: 'Security',
  tabMfa: 'MFA',
  tabAlerts: 'Alerts',
  loadFailed: 'Security details are unavailable.',
  commandFailed: 'The security command failed.',
  sessionUpdateFailed: 'Verification succeeded, but the session was not updated. Sign out and sign in again before a privileged action.',
  recoveryReenrollFailed: 'Recovery succeeded, but re-enrollment did not start. Start enrollment manually.',
  enrollLoadFailed: 'Authenticator status could not be loaded.',
  enrollLoading: 'Loading authenticator status…',
  eventsLoading: 'Loading security alerts…',
  working: 'Working…',
  sendingTestAlert: 'Sending test alert…',
  activating: 'Activating…',
  recoveryCodesOnce: 'These recovery codes are shown once. Store them outside the browser. Each code works only once.',
  recoveryCodeLabel: 'Recovery code',
  promptTitle: 'Set up an authenticator',
  promptBody: 'Connect an authenticator app to protect this Platform Owner account. This is optional until MFA is permanently activated.',
  promptAccept: 'Set up authenticator',
  promptDecline: 'Not now',
  sectionTitle: 'Authenticator',
  statusEnrolled: 'Authenticator is enrolled.',
  statusNotEnrolled: 'Authenticator is not enrolled.',
  pendingEnrollment: 'An enrollment is in progress. Scan the QR code and verify a six-digit code.',
  enroll: 'Connect authenticator',
  qrTitle: 'Scan with Google Authenticator',
  codeLabel: 'Six-digit code',
  verify: 'Verify code',
  cancel: 'Cancel enrollment',
  remove: 'Remove authenticator',
  replace: 'Replace authenticator',
  recoveryAvailable: 'Recovery codes can be issued after a verified authenticator session.',
  recoveryUnavailable: 'Recovery codes are not available yet.',
  issueRecovery: 'Generate recovery codes',
  recover: 'Recover with a recovery code',
  verifyRecovery: 'Verify recovery readiness',
  deviceTrusted: 'This device is trusted.',
  deviceUntrusted: 'This device is not trusted.',
  deviceUnavailable: 'Trusted-device status is not available.',
  trustDevice: 'Trust this device',
  revokeDevice: 'Revoke trusted device',
  policyOptional: 'MFA is optional until permanent activation.',
  policyMandatoryActive: 'MFA is permanently required for Platform Owner access.',
  policyMandatoryInactive: 'MFA will be required after permanent activation.',
  suspiciousUnavailable: 'Suspicious-sign-in review is not configured on this screen.',
  enrollmentComplete: 'Authenticator is enrolled and verified.',
  enrollmentIncomplete: 'Authenticator enrollment is not complete.',
  totpVerified: 'This session was verified with an authenticator code.',
  totpRequired: 'A fresh authenticator code is required.',
  recoveryReady: 'Recovery codes are ready.',
  recoveryMissing: 'No recovery codes are available.',
  drillDone: 'Recovery procedure has been tested.',
  drillNeeded: 'Recovery procedure has not been tested.',
  enforcementOff: 'MFA is not permanently activated.',
  enforcementOn: 'MFA Permanently Active',
  enforcementUnreadable: 'MFA enforcement state is unreadable.',
  activate: 'Activate MFA Permanently',
  active: 'MFA Permanently Active',
  alertsTitle: 'Security alerts',
  alertsNotConfigured: 'Security alerts are not configured for external delivery.',
  alertsConfigured: 'An alert destination is configured. This screen does not prove that a message arrived.',
  providerConfigured: 'Email provider is configured.',
  providerNotConfigured: 'Email provider is not configured.',
  destinationVerified: 'Verified destination',
  destinationUnavailable: 'Verified owner destination is not available.',
  deliveryPending: 'Delivery pending',
  deliveryAccepted: 'Provider accepted',
  deliveryFailed: 'Delivery failed',
  filterAll: 'All',
  filterSeverity: 'Severity',
  filterEventType: 'Event type',
  filterDeliveryStatus: 'Delivery status',
  recentDeliveries: 'Recent alert deliveries',
  sourceUnknown: 'Unknown',
  testLabel: 'TEST',
  geoIpAttributionFallback: 'IP geolocation data by DB-IP.com — CC BY 4.0',
  deliveryFailures: (hours: number, count: number) =>
    `Delivery failures in the last ${hours} hours: ${count}`,
  sendTestAlert: 'Send Test Alert',
  testDelivered: 'Test command was accepted by the destination.',
  testNotDelivered: (reason?: string) =>
    reason ? `Test command was not delivered: ${reason}` : 'Test command was not delivered.',
  noEvents: 'No security events in this window.',
  severity: {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  } as const,
} as const;

export function englishEventAction(action: string): string {
  const known: Record<string, string> = {
    deliver_security_test_alert: 'Test alert',
    'security.test_alert': 'Test alert',
    'security.login_failed': 'Failed login attempt',
    'security.suspicious_repeated': 'Repeated suspicious activity',
    'security.suspicious_sign_in': 'Suspicious authentication activity',
    'security.forbidden': 'Forbidden privileged operation',
    'security.unauthorized': 'Unauthorized access attempt',
    'security.privileged_mfa_failed': 'Privileged MFA access failure',
    'security.mfa_recovery_consumed': 'MFA recovery consumed',
    'security.platform_owner_mfa_activated': 'Permanent MFA activation',
    'security.alert_delivery_failed': 'Security alert delivery failure',
    activate_platform_owner_mfa: 'Permanent MFA activation',
    verify_platform_owner_mfa_recovery: 'Recovery readiness verification',
    enroll_mfa: 'Authenticator enrollment',
    verify_mfa: 'Authenticator verification',
    recover_mfa: 'MFA recovery',
    issue_mfa_recovery_codes: 'Recovery codes issued',
    trust_mfa_device: 'Trusted device added',
    revoke_trusted_device: 'Trusted device revoked',
  };
  if (known[action]) return known[action];
  return action
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function englishSeverity(severity: string): string {
  if (severity === 'critical' || severity === 'high' || severity === 'medium' || severity === 'low') {
    return OWNER_SECURITY_COPY.severity[severity];
  }
  return severity;
}
