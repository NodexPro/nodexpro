import en from '../i18n/en.json';
import he from '../i18n/he.json';
import ru from '../i18n/ru.json';

export type LoginUiLang = 'en' | 'he' | 'ru';

const catalogs: Record<LoginUiLang, { auth: Record<string, string> }> = {
  en: { auth: en.auth },
  he: { auth: he.auth },
  ru: { auth: ru.auth },
};

export function loginUiLang(raw: string | null | undefined): LoginUiLang {
  if (raw === 'he' || raw === 'ru') return raw;
  return 'en';
}

export function formatLoginSecurityTemplate(template: string, seconds: number): string {
  return template.replaceAll('{seconds}', String(Math.max(1, seconds)));
}

export function loginSecurityText(lang: LoginUiLang, key: keyof typeof en.auth, seconds?: number): string {
  const template = catalogs[lang].auth[key] ?? catalogs.en.auth[key] ?? key;
  return seconds == null ? template : formatLoginSecurityTemplate(template, seconds);
}

export function retryAfterSecondsFromFailure(input: {
  status?: number;
  retryAfter?: unknown;
}): number {
  if (input.status !== 429) return 0;
  const value = Number(input.retryAfter);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(3600, Math.floor(value));
}

export function loginCooldownMessage(seconds: number, lang: LoginUiLang = 'en'): string {
  return loginSecurityText(lang, 'cooldown', seconds);
}

export function remainingCooldownSeconds(untilMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((untilMs - nowMs) / 1000));
}

export function offerRecoveryFromFailure(input: { offerRecovery?: unknown }): boolean {
  return input.offerRecovery === true;
}

export function loginFailureCode(input: { code?: string; status?: number }): 'TOO_MANY_REQUESTS' | 'INVALID_CREDENTIALS' | 'LOGIN_CHALLENGE_REQUIRED' | null {
  if (input.code === 'TOO_MANY_REQUESTS' || input.status === 429) return 'TOO_MANY_REQUESTS';
  if (input.code === 'LOGIN_CHALLENGE_REQUIRED') return 'LOGIN_CHALLENGE_REQUIRED';
  if (input.code === 'INVALID_CREDENTIALS' || input.code === 'BAD_REQUEST') return 'INVALID_CREDENTIALS';
  return null;
}

export function loginChallengeFromResponse(input: {
  required?: unknown;
  command?: unknown;
}): { required: boolean; command: 'verify_mfa' | null } {
  if (input.required !== true) return { required: false, command: null };
  return { required: true, command: 'verify_mfa' };
}

export function readLoginStamp(storage: Pick<Storage, 'getItem' | 'setItem'> | null): string {
  const existing = storage?.getItem('nx_login_stamp');
  if (existing && /^[a-f0-9]{32}$/.test(existing)) return existing;
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 17 + 3) % 256;
  }
  const next = Array.from(bytes, (item) => item.toString(16).padStart(2, '0')).join('');
  storage?.setItem('nx_login_stamp', next);
  return next;
}
