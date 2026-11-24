import crypto from 'crypto';

export function digestWebhookPayload(rawBody: string): string {
  return crypto.createHash('sha256').update(String(rawBody ?? ''), 'utf8').digest('hex');
}

export function webhookMayMutateState(input: {
  signatureOk: boolean;
  alreadyProcessed: boolean;
}): { ok: true } | { ok: false; code: 'PAYMENT_SIGNATURE_INVALID' | 'PAYMENT_EVENT_DUPLICATE' } {
  if (input.signatureOk !== true) return { ok: false, code: 'PAYMENT_SIGNATURE_INVALID' };
  if (input.alreadyProcessed) return { ok: false, code: 'PAYMENT_EVENT_DUPLICATE' };
  return { ok: true };
}

export function redactPaymentLog(value: Record<string, unknown>): Record<string, unknown> {
  const blocked = /secret|password|api[_-]?key|token|authorization|credential/i;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = blocked.test(key) ? '[redacted]' : item;
  }
  return out;
}
