/**
 * OTP / secret logging rules. Never put plaintext OTP, phones, tokens, or keys in logs.
 */

export const DEV_PAYMENT_OTP_ENV = 'ALLOW_DEV_PAYMENT_OTP';

export function isProductionNodeEnv(nodeEnv: string | undefined): boolean {
  return (nodeEnv ?? '').trim() === 'production';
}

export function isTwilioSmsConfigured(env: {
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
}): boolean {
  return Boolean(
    env.TWILIO_ACCOUNT_SID?.trim() && env.TWILIO_AUTH_TOKEN?.trim() && env.TWILIO_FROM_NUMBER?.trim(),
  );
}

export function paymentOtpUnconfiguredLogMessage(): string {
  return '[payment-card-sms] Twilio not configured — OTP delivery skipped';
}

export type OtpDeliveryDecision =
  | { action: 'send_sms' }
  | { action: 'fail_closed'; code: 'SMS_PROVIDER_NOT_CONFIGURED'; message: string }
  | { action: 'dev_skip'; log: string };

export function decideOtpSmsDelivery(params: {
  nodeEnv: string | undefined;
  twilioConfigured: boolean;
  allowDevSkip: boolean;
}): OtpDeliveryDecision {
  if (params.twilioConfigured) return { action: 'send_sms' };
  if (isProductionNodeEnv(params.nodeEnv) || !params.allowDevSkip) {
    return {
      action: 'fail_closed',
      code: 'SMS_PROVIDER_NOT_CONFIGURED',
      message: 'SMS provider is not configured.',
    };
  }
  return { action: 'dev_skip', log: paymentOtpUnconfiguredLogMessage() };
}

export function logTextContainsSecrets(text: string, secrets: Array<string | null | undefined>): boolean {
  const hay = String(text ?? '');
  if (!hay) return false;
  return secrets.some((s) => {
    const v = String(s ?? '').trim();
    return v.length > 0 && hay.includes(v);
  });
}

export const DEFAULT_LEGAL_IDENTITY_HASH_SALT = 'dev-salt-change-in-production';
export const DEFAULT_OTP_PEPPER = 'dev-only-pepper-set-SENSITIVE_ACCESS_CODE_PEPPER';

export function isUnsafeDefaultSecret(value: string | null | undefined, defaultValue: string): boolean {
  return !value?.trim() || value.trim() === defaultValue;
}
