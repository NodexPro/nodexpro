export const SECURITY_ALERT_FROM_NAME = 'NodexPro Security Alert';
export const SECURITY_ALERT_SUBJECT = 'NodexPro Security Alert';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function withSecurityAlertSender<T extends { fromName: string }>(provider: T): T {
  return { ...provider, fromName: SECURITY_ALERT_FROM_NAME };
}

export function buildSecurityAlertEmail(input: {
  eventKind: 'security' | 'test';
  severity: string;
  eventAction: string;
  alertId: string;
  eventTime: string;
  correlationId?: string | null;
  sourceIp?: string | null;
  country?: string | null;
  city?: string | null;
  maskedTarget?: string | null;
}): { subject: string; fromName: string; text: string; html: string } {
  const test = input.eventKind === 'test';
  const sourceIp = input.sourceIp && input.sourceIp !== 'Unknown' ? input.sourceIp : 'Unknown';
  const knownIp = sourceIp !== 'Unknown';
  const country = knownIp && input.country && input.country !== 'Unknown' ? input.country : null;
  const city = knownIp && input.city && input.city !== 'Unknown' ? input.city : null;
  const location = knownIp && (country || city) ? `${country ?? 'Unknown'}, ${city ?? 'Unknown'}` : 'Unknown';
  const lines = [
    test
      ? 'This is a user-requested NodexPro Security Alert test. It is not a security incident.'
      : 'A confirmed NodexPro security event was recorded.',
    `Event: ${input.eventAction}`,
    `Severity: ${input.severity}`,
    `Time: ${input.eventTime}`,
    `Alert ID: ${input.alertId}`,
    ...(input.correlationId ? [`Correlation ID: ${input.correlationId}`] : []),
    ...(input.maskedTarget ? [`Attempted identity: ${input.maskedTarget}`] : []),
    `Source IP: ${sourceIp}`,
    `Approximate location: ${location}`,
  ];
  return {
    subject: SECURITY_ALERT_SUBJECT,
    fromName: SECURITY_ALERT_FROM_NAME,
    text: [`NodexPro Security Alert`, ...lines].join('\n'),
    html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
  <h1 style="font-size:18px;margin:0 0 12px 0">${escapeHtml(SECURITY_ALERT_SUBJECT)}</h1>
  <p style="margin:0">${lines.map(escapeHtml).join('<br>')}</p>
</div>`,
  };
}
