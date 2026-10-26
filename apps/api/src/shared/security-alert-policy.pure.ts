export type SecurityAlertSeverity = 'critical' | 'high' | 'medium' | 'low';

export function securityAlertSeverity(action: string): SecurityAlertSeverity {
  if (action === 'security.alert_delivery_failed' || action === 'security.privileged_mfa_failed') return 'critical';
  if (action === 'security.platform_owner_mfa_activated') return 'critical';
  if (action === 'security.mfa_recovery_consumed') return 'high';
  if (action === 'security.session_compromised') return 'critical';
  if (
    action === 'security.suspicious_sign_in' ||
    action === 'security.suspicious_repeated' ||
    action === 'security.credential_stuffing' ||
    action === 'security.token_abuse' ||
    action === 'security.upload_rejected_malicious'
  ) {
    return 'high';
  }
  if (action === 'security.forbidden' || action === 'security.unauthorized') return 'medium';
  return 'low';
}

export function shouldQueueSecurityAlert(action: string): boolean {
  if (action === 'security.alert_delivery_failed' || action === 'security.test_alert') return false;
  if (action === 'security.login_failed' || action === 'security.suspicious_sign_in' || action === 'security.suspicious_repeated') {
    return false;
  }
  const severity = securityAlertSeverity(action);
  return severity === 'critical' || severity === 'high';
}
