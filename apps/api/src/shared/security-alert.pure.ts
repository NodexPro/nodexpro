export type SecurityAlertDecision =
  | { deliver: false; reason: 'destination_not_configured' }
  | { deliver: true; url: string };

export function decideSecurityAlert(webhookUrl: string | null | undefined): SecurityAlertDecision {
  const url = String(webhookUrl ?? '').trim();
  if (!url) return { deliver: false, reason: 'destination_not_configured' };
  return { deliver: true, url };
}

export function securityTestAlertBody(correlationId: string): { event: string; correlation_id: string } {
  return { event: 'security.test', correlation_id: correlationId };
}
