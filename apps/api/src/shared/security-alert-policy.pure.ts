export type SecurityAlertSeverity = 'critical' | 'high' | 'medium' | 'low';

export function securityAlertSeverity(action: string): SecurityAlertSeverity {
  if (action === 'security.alert_delivery_failed' || action === 'security.privileged_mfa_failed') return 'critical';
  if (action === 'security.platform_owner_mfa_activated') return 'critical';
  if (action === 'security.mfa_recovery_consumed') return 'high';
  if (action === 'security.suspicious_sign_in' || action === 'security.suspicious_repeated') return 'high';
  if (action === 'security.forbidden' || action === 'security.unauthorized') return 'medium';
  return 'low';
}

export function shouldQueueSecurityAlert(action: string): boolean {
  if (action === 'security.alert_delivery_failed' || action === 'security.test_alert') return false;
  const severity = securityAlertSeverity(action);
  return severity === 'critical' || severity === 'high' || action === 'security.suspicious_repeated';
}
